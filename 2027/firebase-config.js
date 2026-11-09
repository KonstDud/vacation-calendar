import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAZTTvp4KIf_j5Dop59SIW6n8X2GBZvZE0",
    authDomain: "vacation-calendar-2026.firebaseapp.com",
    projectId: "vacation-calendar-2026",
    storageBucket: "vacation-calendar-2026.firebasestorage.app",
    messagingSenderId: "619665470112",
    appId: "1:619665470112:web:d4679b0d4d1694c38c8fc5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Экспортируем всё необходимое
window.db = db;
window.firestore = { collection, doc, setDoc, getDoc, deleteDoc };
console.log('Firebase loaded, db:', db);