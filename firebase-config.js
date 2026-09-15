'use strict';

// Public client identifiers for the "Autoimmunity" Firebase project — safe to
// have in client code. Actual data protection comes from the Firestore
// security rules (each user can only read/write their own users/{uid} doc),
// not from hiding these values.
const firebaseConfig = {
  apiKey: "AIzaSyDKGFqpqi1BNOmBPg0NM5fL3nchy_AeQQk",
  authDomain: "autoimmunity-2af71.firebaseapp.com",
  projectId: "autoimmunity-2af71",
  storageBucket: "autoimmunity-2af71.firebasestorage.app",
  messagingSenderId: "803453803568",
  appId: "1:803453803568:web:3e9609858d8cd22165a1f5",
  measurementId: "G-227PT0XKF0"
};

firebase.initializeApp(firebaseConfig);
