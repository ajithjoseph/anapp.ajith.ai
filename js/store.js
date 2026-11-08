// Everything that talks to Firebase lives here. The rest of the app only
// calls these functions, so the page works (read-only, with a note) before
// Firebase is set up, and tests can swap this file for a fake.
//
// Firestore layout (rules in firestore.rules enforce all of it):
//   users/{uid}            public profile: handle, name, bio, tz
//   handles/{handle}       { uid }: makes usernames unique
//   plans/{uid_day}        a maker's private plan for one day
//   launches/{uid_day}     one launch per maker per day, public
//   votes/{launchId_uid}   one upvote; launches.votes keeps the count

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let fb = null; // { auth, db, ...sdk functions }
let configured = false;
let current = null; // signed-in Firebase user
const listeners = new Set();

export const ready = (async () => {
  let cfg = {};
  try {
    cfg = await (await fetch('/config.json', { cache: 'no-cache' })).json();
  } catch {
    /* no config: read-only */
  }
  if (!cfg.firebase?.apiKey) return { configured: false };
  const [app, auth, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const fbApp = app.initializeApp(cfg.firebase);
  fb = { ...auth, ...fs, auth: auth.getAuth(fbApp), db: fs.getFirestore(fbApp) };
  configured = true;
  await new Promise((resolve) => {
    fb.onAuthStateChanged(fb.auth, (u) => {
      current = u;
      for (const cb of listeners) cb(u);
      resolve();
    });
  });
  return { configured: true };
})();

export const isConfigured = () => configured;
export const user = () => current;
export function onUser(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function need() {
  if (!configured) throw new Error('Sign-in isn’t switched on yet.');
  if (!current) throw new Error('Sign in first');
}

const ref = (...path) => fb.doc(fb.db, ...path);
const data = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null);

export async function signIn() {
  if (!configured) throw new Error('Sign-in isn’t switched on yet.');
  await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
}

export async function signOut() {
  if (configured) await fb.signOut(fb.auth);
}

// ---- profiles --------------------------------------------------------------

export async function myProfile() {
  if (!configured || !current) return null;
  return data(await fb.getDoc(ref('users', current.uid)));
}

// Claims the username and writes the profile in one batch, so a username
// can't be half-taken. The rules refuse a username someone already has.
export async function createProfile({ handle, name, tz }) {
  need();
  const batch = fb.writeBatch(fb.db);
  batch.set(ref('handles', handle), { uid: current.uid });
  batch.set(ref('users', current.uid), {
    handle,
    name,
    bio: '',
    tz,
    createdAt: fb.serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    if (e.code === 'permission-denied') throw new Error('That username is taken');
    throw e;
  }
}

export async function updateProfile({ name, bio, tz }) {
  need();
  await fb.updateDoc(ref('users', current.uid), { name, bio, tz });
}

export async function profileByHandle(handle) {
  const h = data(await fb.getDoc(ref('handles', handle)));
  if (!h) return null;
  const u = data(await fb.getDoc(ref('users', h.uid)));
  if (!u) return null;
  const snaps = await fb.getDocs(
    fb.query(fb.collection(fb.db, 'launches'), fb.where('uid', '==', h.uid), fb.limit(1000)),
  );
  const launches = snaps.docs.map(data).sort((a, b) => (a.day < b.day ? 1 : -1));
  return { user: u, launches };
}

// ---- plans -----------------------------------------------------------------

export async function getPlan(day) {
  if (!configured || !current) return null;
  return data(await fb.getDoc(ref('plans', `${current.uid}_${day}`)));
}

export async function savePlan(day, { idea, scope, steps }) {
  need();
  await fb.setDoc(ref('plans', `${current.uid}_${day}`), { uid: current.uid, day, idea, scope, steps });
}

// ---- launches --------------------------------------------------------------

export async function getLaunch(day) {
  if (!configured || !current) return null;
  return data(await fb.getDoc(ref('launches', `${current.uid}_${day}`)));
}

export async function saveLaunch(day, profile, fields) {
  need();
  const r = ref('launches', `${current.uid}_${day}`);
  const existing = await fb.getDoc(r);
  const body = { ...fields, handle: profile.handle, name: profile.name, updatedAt: fb.serverTimestamp() };
  if (existing.exists()) {
    await fb.updateDoc(r, body);
  } else {
    await fb.setDoc(r, { ...body, uid: current.uid, day, votes: 0, createdAt: fb.serverTimestamp() });
  }
}

export async function deleteLaunch(day) {
  need();
  await fb.deleteDoc(ref('launches', `${current.uid}_${day}`));
}

const launchesCol = () => fb.collection(fb.db, 'launches');

export async function latest(after = null, size = 30) {
  if (!configured) return { launches: [], next: null };
  const parts = [launchesCol(), fb.orderBy('createdAt', 'desc')];
  if (after) parts.push(fb.startAfter(after));
  parts.push(fb.limit(size));
  const snaps = await fb.getDocs(fb.query(...parts));
  return {
    launches: snaps.docs.map(data),
    next: snaps.docs.length === size ? snaps.docs.at(-1) : null,
  };
}

// Launches on or after a day, for "top this week". Sorted by votes here,
// because sorting by votes in Firestore with a day filter needs an index.
export async function since(day, max = 500) {
  if (!configured) return [];
  const snaps = await fb.getDocs(fb.query(launchesCol(), fb.where('day', '>=', day), fb.limit(max)));
  return snaps.docs.map(data);
}

// Every launch's day and maker, for the streaks leaderboard. Fine for a few
// thousand launches; past that, keep streaks on the user documents.
export async function allLaunchDays(max = 5000) {
  if (!configured) return [];
  const snaps = await fb.getDocs(fb.query(launchesCol(), fb.limit(max)));
  return snaps.docs.map(data);
}

export async function stats(yesterday) {
  if (!configured) return null;
  const count = async (q) => (await fb.getCountFromServer(q)).data().count;
  const [makers, launches, recent] = await Promise.all([
    count(fb.collection(fb.db, 'users')),
    count(launchesCol()),
    count(fb.query(launchesCol(), fb.where('day', '>=', yesterday))),
  ]);
  return { makers, launches, recent };
}

// ---- votes -----------------------------------------------------------------

let myVoteIds = null;

export async function myVotes() {
  if (!configured || !current) return new Set();
  if (!myVoteIds) {
    const snaps = await fb.getDocs(
      fb.query(fb.collection(fb.db, 'votes'), fb.where('uid', '==', current.uid), fb.limit(5000)),
    );
    myVoteIds = new Set(snaps.docs.map((d) => d.data().launchId));
  }
  return myVoteIds;
}

// The vote and the count change in one batch; the rules check they match.
export async function toggleVote(launch) {
  need();
  const mine = await myVotes();
  const voted = mine.has(launch.id);
  const batch = fb.writeBatch(fb.db);
  const v = ref('votes', `${launch.id}_${current.uid}`);
  if (voted) batch.delete(v);
  else batch.set(v, { uid: current.uid, launchId: launch.id });
  batch.update(ref('launches', launch.id), { votes: fb.increment(voted ? -1 : 1) });
  await batch.commit();
  if (voted) mine.delete(launch.id);
  else mine.add(launch.id);
  return { voted: !voted, votes: (launch.votes ?? 0) + (voted ? -1 : 1) };
}

onUser(() => {
  myVoteIds = null;
});
