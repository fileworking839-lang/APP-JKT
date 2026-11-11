import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager, 
  CACHE_SIZE_UNLIMITED,
  memoryLocalCache 
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBEgdscxiW6uTLGVJCdzrjYVtJFzsDWuSw",
  authDomain: "apk-jkt.firebaseapp.com",
  projectId: "apk-jkt",
  storageBucket: "apk-jkt.firebasestorage.app",
  messagingSenderId: "116878113263",
  appId: "1:116878113263:web:a354e19afa1febf7fd1e1a"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let firestoreDb: any;

try {
  firestoreDb = getFirestore(app);
} catch {
  // Not initialized yet
}

if (!firestoreDb) {
  try {
    firestoreDb = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: CACHE_SIZE_UNLIMITED
      })
    });
  } catch {
    try {
      firestoreDb = getFirestore(app);
    } catch {
      try {
        firestoreDb = initializeFirestore(app, {
          localCache: memoryLocalCache()
        });
      } catch {
        firestoreDb = getFirestore(app);
      }
    }
  }
}

export const db = firestoreDb;
export const auth = getAuth(app);
export { app };