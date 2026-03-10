import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, writeBatch, enableIndexedDbPersistence, runTransaction } from "firebase/firestore";

// ============================================================
// FIREBASE SETUP
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDQvdmMYRsoBZlZ1AvUQyBqBD1EXs5QM48",
  authDomain: "fashionpro-db.firebaseapp.com",
  projectId: "fashionpro-db",
  storageBucket: "fashionpro-db.firebasestorage.app",
  messagingSenderId: "698289947835",
  appId: "1:698289947835:web:ee8fad3a2ea6dd73aed59e"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Offline persistence — data cached locally, syncs when internet returns ──
// BUG23 FIX: multi-tab warning user ko visible karo — sirf console mein nahi
let multiTabWarning = false;
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    multiTabWarning = true;
    console.warn("Offline persistence: multiple tabs open — only one tab supported");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence: browser does not support IndexedDB");
  }
});

// Save entire array to Firestore collection (batch)
// When offline: saves to IndexedDB cache automatically (Firebase handles it)
const saveCollection = async (colName, items) => {
  try {
    const batch = writeBatch(db);
    items.forEach(item => {
      batch.set(doc(db, colName, String(item.id)), item);
    });
    await batch.commit();
  } catch(e) {
    // If network error — Firebase IndexedDB persistence handles it automatically
    if (e.code !== "unavailable") console.error("Firebase save error:", e);
  }
};

// Delete one document
const deleteFromCol = async (colName, id) => {
  try { await deleteDoc(doc(db, colName, String(id))); }
  catch(e) { if (e.code !== "unavailable") console.error("Firebase delete error:", e); }
};

// BUG25 FIX: IST date utility — toISOString() UTC hai, India IST +5:30
// Raat 11:30 ke baad bill karo → "kal" filter mein jaayega UTC se — fix kiya
const getISTDateStr = () => {
  const now = new Date();
  // IST = UTC + 5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return istNow.toISOString().split("T")[0]; // YYYY-MM-DD in IST
};

// BUG26 FIX: week filter ke liye IST-aware N-days-ago date
const getISTDaysAgo = (days) => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  // Subtract N days worth of milliseconds
  const past = new Date(istNow.getTime() - days * 24 * 60 * 60 * 1000);
  return past.toISOString().split("T")[0]; // YYYY-MM-DD in IST
};

// BUG20 FIX: saveSingle — sirf ek document update karo, poori collection nahi
// 500 products hain → ek change pe 500 writes nahi, sirf 1
const saveSingle = async (colName, item) => {
  try {
    await setDoc(doc(db, colName, String(item.id)), item);
  } catch(e) {
    if (e.code !== "unavailable") console.error("Firebase save error:", e);
  }
};

// ============================================================
// DATA STORE (In-memory, persistent via state)
// ============================================================
const INITIAL_PRODUCTS = [];
const INITIAL_CUSTOMERS = [];
const INITIAL_SALES = [];
const INITIAL_PURCHASES = [];

const CATEGORIES = ["Shirt", "T-Shirt", "Jeans", "Kurta", "Trousers", "Jacket", "Shorts", "Ethnic Wear", "Other"];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36", "38", "40", "60", "65", "70", "75", "80", "85", "90", "95", "100", "105", "110"];

// ============================================================
// ICONS (SVG)
// ============================================================
const Icon = ({ name, size = 18 }) => {
  const icons = {
    dashboard: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
    inventory: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
    billing: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
    purchases: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />,
    customers: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
    reports: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
    settings: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />,
    plus: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />,
    search: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
    edit: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />,
    trash: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />,
    close: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />,
    alert: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
    check: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />,
    print: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />,
    logout: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />,
    tag: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />,
    download: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />,
    trend: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
    shirt: <><rect x="3" y="9" width="18" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9l3-6h3s0 3 3 3 3-3 3-3h3l3 6"/></>,
    rupee: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 8h6M9 12h6M9 16l3-4 3 4M6 4h12M6 8h.01" />,
    eye: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>,
    whatsapp: null,
  };
  if (name === "whatsapp") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {icons[name]}
    </svg>
  );
};

// ============================================================
// LOGIN SCREEN
// ============================================================
const LoginScreen = ({ onLogin }) => {
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(false);

  const handleLogin = () => {
    if (user === "admin" && pass === "shop123") {
      onLogin({ name: "Admin", role: "admin" });
    } else if (user === "staff" && pass === "staff123") {
      onLogin({ name: "Staff", role: "staff" });
    } else {
      setErr("Invalid credentials. Try admin/shop123 or staff/staff123");
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        .login-card { animation: fadeUp 0.6s ease forwards; }
        .shake { animation: shake 0.5s ease; }
        .login-btn { background: linear-gradient(135deg, #f093fb, #f5576c); border: none; color: white; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; transition: all 0.3s; letter-spacing: 0.5px; }
        .login-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(240,147,251,0.4); }
        .login-input { width: 100%; background: rgba(255,255,255,0.07); border: 1.5px solid rgba(255,255,255,0.15); color: white; padding: 13px 16px; border-radius: 12px; font-size: 14px; outline: none; box-sizing: border-box; transition: border 0.2s; font-family: 'DM Sans', sans-serif; }
        .login-input:focus { border-color: rgba(240,147,251,0.6); }
        .login-input::placeholder { color: rgba(255,255,255,0.35); }
      `}</style>
      <div className={`login-card ${shake ? "shake" : ""}`} style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: "48px 40px", width: 380, boxShadow: "0 25px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, background: "linear-gradient(135deg, #f093fb, #f5576c)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 28 }}>👔</div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", color: "white", fontSize: 28, margin: "0 0 6px", fontWeight: 700 }}>FashionPro</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, margin: 0 }}>Clothing Shop Management System</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6, letterSpacing: "0.5px", textTransform: "uppercase" }}>Username</label>
            <input className="login-input" value={user} onChange={e => setUser(e.target.value)} placeholder="Enter username" />
          </div>
          <div>
            <label style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6, letterSpacing: "0.5px", textTransform: "uppercase" }}>Password</label>
            <input className="login-input" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Enter password" />
          </div>
          {err && <p style={{ color: "#f5576c", fontSize: 12, margin: "0", textAlign: "center" }}>{err}</p>}
          <button className="login-btn" onClick={handleLogin} style={{ marginTop: 8 }}>Sign In →</button>
        </div>
        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, textAlign: "center", marginTop: 24, marginBottom: 0 }}>Admin: admin/shop123 &nbsp;|&nbsp; Staff: staff/staff123</p>
      </div>
    </div>
  );
};


// ============================================================
// GLOBAL INVOICE DRAWER — Unified invoice modal used everywhere
// Dashboard, BillHistory, Customers, Reports — all use this one component
// Features: Replace Item, Return Items, Undo, Delete Invoice, version history
// ============================================================
const GlobalInvoiceDrawer = ({ sale, onClose, products, isAdmin, shopName, setActiveTab, setGlobalInvoiceSale, setHighlightPhone, setInventoryNav, setSales, setProducts, setCustomers }) => {
  const nowISO = () => new Date().toISOString();

  // ── Local state for current sale (so actions update UI immediately) ──
  const [curSale, setCurSale] = useState(sale);
  const [mode, setMode] = useState(null); // null | "replace" | "return"

  // Replace state
  const [replaceIdx, setReplaceIdx] = useState(null);
  const [replaceNewName, setReplaceNewName] = useState("");
  const [replaceNewPrice, setReplaceNewPrice] = useState("");
  const [replaceNewQty, setReplaceNewQty] = useState(1);
  const [replaceNewSize, setReplaceNewSize] = useState("");
  const [replaceNewColor, setReplaceNewColor] = useState("");
  const [replaceItemDisc, setReplaceItemDisc] = useState("");
  const [replQuery, setReplQuery] = useState("");
  const [replDropOpen, setReplDropOpen] = useState(false);

  // Return state
  const [returnSelected, setReturnSelected] = useState({});

  const resetModes = () => {
    setMode(null); setReplaceIdx(null);
    setReplaceNewName(""); setReplaceNewPrice(""); setReplaceNewQty(1);
    setReplaceNewSize(""); setReplaceNewColor(""); setReplaceItemDisc("");
    setReplQuery(""); setReplDropOpen(false);
    setReturnSelected({});
  };

  const cv = getCurrentVersion(curSale);
  const cvItems = cv?.items || [];
  const versions = curSale.versions || [getCurrentVersion(curSale)];
  const canUndo = versions.length > 1;

  // ── v0 shortfall ──
  const saleV0 = curSale?.versions?.[0] ?? getCurrentVersion(curSale);
  const saleV0Total = saleV0?.total || 0;
  const saleV0Received = saleV0 ? (saleV0.received ?? saleV0.total) : 0;
  const salePayRatio = saleV0Total > 0 ? Math.min(1, saleV0Received / saleV0Total) : 1;
  const v0Total = saleV0?.total || 0;
  const v0Received = saleV0 ? (saleV0.received ?? saleV0.total) : 0;
  const origShortfall = Math.max(0, v0Total - v0Received);
  const receivedAmt = cv.received ?? cv.total;

  const getEffTotal = (item, version) => {
    if (item.effectiveTotal !== undefined) return item.effectiveTotal;
    const mrp = item.price * item.qty;
    const iDiscRs = item.itemDiscountRs ?? item.itemDiscount ?? 0;
    if (iDiscRs > 0) return Math.max(0, mrp - iDiscRs);
    const bd = version?.billDiscount || 0;
    const eligSub = (version?.items || []).filter(it => !(it.itemDiscountRs > 0 || it.itemDiscount > 0)).reduce((a, b) => a + b.price * b.qty, 0);
    return Math.max(0, mrp - Math.round(mrp * (eligSub > 0 ? bd / eligSub : 0)));
  };

  // ── Return refund calc ──
  const totalReturnRefund = Object.entries(returnSelected).reduce((sum, [idx, qty]) => {
    const item = cvItems[+idx];
    if (!item || qty <= 0) return sum;
    const eff = getEffTotal(item, cv);
    const actualPerUnit = Math.round((eff * salePayRatio) / Math.max(1, item.qty));
    return sum + actualPerUnit * qty;
  }, 0);

  // ── Update sale helper ──
  const updateSale = (updated) => {
    setCurSale(updated);
    if (setSales) setSales(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  // ── Find product in inventory ──
  const findProduct = (item) =>
    products.find(p => {
      if (p.name.toLowerCase() !== item.name.toLowerCase()) return false;
      if (p.pricingType === "size-variant")
        return p.sizeVariants?.some(sv => !item.size || item.size === "-" || sv.size === item.size);
      return true;
    });

  // ── Product click → open in inventory ──
  const handleProductClick = (item) => {
    if (!isAdmin) return;
    const prod = findProduct(item);
    onClose();
    setActiveTab("inventory");
    if (prod) {
      setInventoryNav({ type: "edit", productId: prod.id });
    } else {
      setInventoryNav({
        type: "add",
        prefill: {
          name: item.name,
          sellingPrice: String(item.price || ""),
          sizes: item.size && item.size !== "-" ? [item.size] : [],
          colors: item.color && item.color !== "-" ? item.color : "",
        }
      });
    }
  };

  // ── REPLACE ITEM ──
  const doReplace = () => {
    if (replaceIdx === null || !replaceNewName || !replaceNewPrice) return;
    const oldItem = cvItems[replaceIdx];
    const oldEffFull = getEffTotal(oldItem, cv);
    const oldActualPaid = Math.round(oldEffFull * salePayRatio);
    const newPrice = +replaceNewPrice;
    const newQty = +replaceNewQty || 1;
    const newItemDiscRs = replaceItemDisc ? +replaceItemDisc : 0;
    const newEff = Math.max(0, newPrice * newQty - newItemDiscRs);
    const diff = oldActualPaid - newEff;

    const newItems = cvItems.map((it, i) => i === replaceIdx ? {
      ...it,
      name: replaceNewName, price: newPrice, qty: newQty,
      size: replaceNewSize || it.size, color: replaceNewColor || it.color,
      itemDiscountRs: newItemDiscRs, itemDiscount: newItemDiscRs, itemDiscountType: "₹",
      effectiveTotal: newEff,
      replacedFrom: `${oldItem.name} ×${oldItem.qty} @ ₹${oldItem.price}`,
    } : it);

    const newRateSubtotal = newItems.reduce((a, b) => a + b.price * b.qty, 0);
    const newItemDiscTotal = newItems.reduce((a, b) => a + (b.itemDiscountRs || 0), 0);
    const origBillDiscRate = cv.billDiscount > 0
      ? cv.billDiscount / (cvItems.filter(it => !(it.itemDiscountRs > 0 || it.itemDiscount > 0)).reduce((a, b) => a + b.price * b.qty, 0) || 1)
      : 0;
    const newEligSub = newItems.filter(it => !(it.itemDiscountRs > 0)).reduce((a, b) => a + b.price * b.qty, 0);
    const newBillDisc = Math.round(newEligSub * origBillDiscRate);
    const newTotal = newItems.reduce((a, it) => a + (it.effectiveTotal ?? it.price * it.qty), 0) - newBillDisc + (cv.tax || 0);

    const newVersion = {
      versionNo: (curSale.versions?.length || 1) + 1,
      type: "replace",
      date: nowISO(),
      items: newItems,
      subtotal: newRateSubtotal,
      rateSubtotal: newRateSubtotal,
      itemDiscountTotal: newItemDiscTotal,
      billDiscount: newBillDisc,
      discount: newItemDiscTotal + newBillDisc,
      tax: cv.tax || 0,
      total: newTotal,
      received: newTotal,
      note: `Replaced: ${oldItem.name} → ${replaceNewName}. ${diff > 0 ? `Refund ₹${diff}` : diff < 0 ? `Collected ₹${Math.abs(diff)}` : "Even exchange"}.`,
      refundOrCharge: diff,
    };
    const updatedSale = pushVersion(curSale, newVersion);
    updateSale(updatedSale);
    resetModes();
    alert(`✅ Replace ho gaya!\n${diff > 0 ? `Customer ko WAPIS KARO: ₹${diff}` : diff < 0 ? `Customer se LENA HAI: ₹${Math.abs(diff)}` : "Barabar exchange!"}\n\n${oldItem.name} → ${replaceNewName}`);
  };

  // ── RETURN ITEMS ──
  const doReturn = () => {
    if (totalReturnRefund <= 0) return;
    const returnedItems = [];
    const newItems = cvItems.map((item, i) => {
      const retQty = returnSelected[i] || 0;
      if (retQty <= 0) return item;
      returnedItems.push({ ...item, returnedQty: retQty });
      const remainQty = item.qty - retQty;
      if (remainQty <= 0) return null;
      const eff = getEffTotal(item, cv);
      const perUnit = Math.round(eff / item.qty);
      return { ...item, qty: remainQty, effectiveTotal: perUnit * remainQty };
    }).filter(Boolean);

    const returnNote = returnedItems.map(it => `${it.name} ×${it.returnedQty}`).join(", ");
    const newRateSubtotal = newItems.reduce((a, b) => a + b.price * b.qty, 0);
    const newItemDiscTotal = newItems.reduce((a, b) => a + (b.itemDiscountRs || 0), 0);
    const eligSub = newItems.filter(it => !(it.itemDiscountRs > 0)).reduce((a, b) => a + b.price * b.qty, 0);
    const origRate = cv.billDiscount > 0
      ? cv.billDiscount / (cvItems.filter(it => !(it.itemDiscountRs > 0 || it.itemDiscount > 0)).reduce((a, b) => a + b.price * b.qty, 0) || 1)
      : 0;
    const newBillDisc = Math.round(eligSub * origRate);
    const newTotal = newItems.reduce((a, it) => a + (it.effectiveTotal ?? it.price * it.qty), 0) - newBillDisc + (cv.tax || 0);

    const newVersion = {
      versionNo: (curSale.versions?.length || 1) + 1,
      type: "return",
      date: nowISO(),
      items: newItems,
      subtotal: newRateSubtotal,
      rateSubtotal: newRateSubtotal,
      itemDiscountTotal: newItemDiscTotal,
      billDiscount: newBillDisc,
      discount: newItemDiscTotal + newBillDisc,
      tax: cv.tax || 0,
      total: newTotal,
      received: newTotal,
      note: `Return: ${returnNote}. Refund to customer: ₹${Math.round(totalReturnRefund)}.`,
      refundOrCharge: Math.round(totalReturnRefund),
    };
    const updatedSale = pushVersion(curSale, newVersion);
    updateSale(updatedSale);

    // Stock wapas karo
    if (setProducts) {
      returnedItems.forEach(retItem => {
        if (!retItem.productId) return;
        setProducts(prev => prev.map(p => {
          if (p.id !== retItem.productId) return p;
          const newQty = p.quantity + retItem.returnedQty;
          if (p.pricingType === "size-variant" && retItem.size && retItem.size !== "-" && p.sizeVariants?.length) {
            const newVariants = p.sizeVariants.map(sv =>
              sv.size === retItem.size ? { ...sv, stock: (sv.stock || 0) + retItem.returnedQty } : sv
            );
            return { ...p, quantity: newQty, sizeVariants: newVariants };
          }
          return { ...p, quantity: newQty };
        }));
      });
    }
    // Customer totalSpent update
    if (setCustomers && curSale.phone) {
      setCustomers(prev => prev.map(c => {
        if (c.phone !== curSale.phone) return c;
        return { ...c, totalSpent: Math.max(0, c.totalSpent - Math.round(totalReturnRefund)) };
      }));
    }

    resetModes();
    const wasPartial = salePayRatio < 1;
    const partialNote = wasPartial ? `\n⚠️ Original bill mein partial payment thi (${Math.round(salePayRatio*100)}% diya tha)\nIsliye refund proportional hai.` : "";
    alert(`✅ Return ho gaya!\n\nCustomer ko WAPIS karo: ₹${Math.round(totalReturnRefund)}${partialNote}\n\nItems: ${returnNote}`);
  };

  // ── UNDO ──
  const doUndo = (targetVersionIdx = null) => {
    if (!curSale.versions || curSale.versions.length <= 1) return;
    const vers = curSale.versions;
    const cutIdx = targetVersionIdx !== null ? targetVersionIdx + 1 : vers.length - 1;
    if (cutIdx <= 0) return;
    const removingCount = vers.length - cutIdx;
    const confirmMsg = removingCount === 1
      ? "Last correction undo karna chahte ho? Woh version hata diya jaayega."
      : `v${cutIdx + 1} se v${vers.length} tak (${removingCount} versions) hata doge?`;
    if (!window.confirm(confirmMsg)) return;
    const newVersions = vers.slice(0, cutIdx);
    const newCurrent = newVersions.length - 1;
    const prevV = newVersions[newCurrent];
    const updatedSale = { ...curSale, versions: newVersions, currentVersion: newCurrent, ...prevV };
    updateSale(updatedSale);
    resetModes();
  };

  // ── DELETE INVOICE ──
  const doDeleteInvoice = () => {
    if (!window.confirm(`Invoice ${curSale.billNo} completely delete karna chahte ho? Yeh undo nahi hoga.`)) return;
    if (setSales) setSales(prev => prev.filter(s => s.id !== curSale.id));
    onClose();
  };

  const vTypeLabel = { original: { text: "Original", color: "#6b7280" }, replace: { text: "🔄 Replaced", color: "#d97706" }, return: { text: "↩️ Returned", color: "#dc2626" } };

  const billDate = (() => { try { const d = new Date(cv.date||curSale.date); return isNaN(d) ? cv.date||curSale.date||"" : d.toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); } catch { return cv.date||curSale.date||""; }})();
  const billTime = (() => { try { const d = new Date(cv.date||curSale.date); const raw = cv.date||curSale.date||""; return (!isNaN(d) && raw.length > 10) ? d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : ""; } catch { return ""; }})();

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:580, maxHeight:"92vh", overflowY:"auto", padding:"20px 20px 24px", borderRadius:20 }}>

        {/* ── Header ── */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
              <h3 style={{ fontSize:20, fontWeight:800, color:"#111827" }}>{curSale.billNo}</h3>
              <span style={{ fontSize:11, background:"#f3f4f6", color:"#6b7280", padding:"2px 8px", borderRadius:10, fontWeight:600 }}>
                v{(curSale.currentVersion ?? versions.length - 1) + 1}/{versions.length}
              </span>
              {versions.length > 1 && (
                <span style={{ fontSize:11, background: cv.type==="return"?"#fef2f2":cv.type==="replace"?"#fff7ed":"#f0fdf4", color: cv.type==="return"?"#dc2626":cv.type==="replace"?"#d97706":"#059669", padding:"2px 10px", borderRadius:10, fontWeight:700 }}>
                  {vTypeLabel[cv.type]?.text || cv.type}
                </span>
              )}
            </div>
            <p style={{ fontSize:12, color:"#9ca3af" }}>📅 {billDate}{billTime ? ` • ⏰ ${billTime}` : ""}</p>
          </div>
          <button onClick={onClose} style={{ background:"#f3f4f6", border:"none", borderRadius:10, width:34, height:34, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#6b7280", flexShrink:0 }}>
            <Icon name="close" size={17} />
          </button>
        </div>

        {/* ── Version History Timeline ── */}
        {versions.length > 1 && (
          <div style={{ background:"#f9fafb", borderRadius:12, padding:"10px 14px", marginBottom:14 }}>
            <p style={{ fontSize:11, fontWeight:800, color:"#9ca3af", textTransform:"uppercase", marginBottom:8 }}>📋 Bill History — click karo dekhne ke liye</p>
            <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
              {versions.map((v, vi) => {
                const isActive = vi === (curSale.currentVersion ?? versions.length - 1);
                const lbl = vTypeLabel[v.type] || { text: v.type, color: "#6b7280" };
                return (
                  <div key={vi}
                    onClick={() => {
                      const updated = { ...curSale, currentVersion: vi };
                      setCurSale(updated);
                      if (setSales) setSales(prev => prev.map(s => s.id === curSale.id ? updated : s));
                    }}
                    style={{ display:"flex", gap:10, alignItems:"flex-start", position:"relative", paddingBottom: vi < versions.length-1 ? 10 : 0, cursor:"pointer" }}>
                    {vi < versions.length-1 && <div style={{ position:"absolute", left:10, top:20, width:2, height:"calc(100% - 4px)", background:"#e5e7eb" }} />}
                    <div style={{ width:20, height:20, borderRadius:"50%", background: isActive ? "#7c3aed" : "#e5e7eb", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background: isActive ? "white" : "#9ca3af" }} />
                    </div>
                    <div style={{ flex:1, background: isActive ? "#f5f3ff" : "transparent", borderRadius:8, padding: isActive ? "6px 10px" : "0 4px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:12, fontWeight: isActive ? 800 : 600, color: isActive ? "#7c3aed" : "#374151" }}>
                          v{v.versionNo} — <span style={{ color: lbl.color }}>{lbl.text}</span>
                        </span>
                        <span style={{ fontSize:12, fontWeight: isActive ? 800 : 600, color: isActive ? "#059669" : "#6b7280" }}>₹{v.total?.toLocaleString()}</span>
                      </div>
                      <p style={{ fontSize:11, color:"#9ca3af", marginTop:1 }}>{v.note}</p>
                      {v.refundOrCharge && v.type !== "original" && (
                        <p style={{ fontSize:11, fontWeight:700, color: v.refundOrCharge > 0 ? "#dc2626" : "#059669", marginTop:1 }}>
                          {v.refundOrCharge > 0 ? `↩ Customer ko diya: ₹${v.refundOrCharge}` : `➕ Customer se liya: ₹${Math.abs(v.refundOrCharge)}`}
                        </p>
                      )}
                      {!isActive && <p style={{ fontSize:10, color:"#c4b5fd", marginTop:2 }}>tap to view →</p>}
                      {isActive && vi > 0 && vi < versions.length - 1 && !mode && (
                        <button onClick={(e) => { e.stopPropagation(); doUndo(vi); }}
                          style={{ marginTop:4, fontSize:10, padding:"2px 8px", background:"#fffbeb", border:"1px solid #fde68a", borderRadius:6, cursor:"pointer", fontWeight:700, color:"#92400e" }}>
                          ↶ Yahan tak restore karo
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Customer ── */}
        <div style={{ background:"#f5f3ff", borderRadius:12, padding:"12px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:38, height:38, background:"linear-gradient(135deg,#7c3aed,#a855f7)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:17, flexShrink:0 }}>
            {(curSale.customer||"W").charAt(0).toUpperCase()}
          </div>
          <div>
            {curSale.phone ? (
              <p onClick={() => { onClose(); setHighlightPhone(curSale.phone); setActiveTab("customers"); }}
                style={{ fontWeight:700, fontSize:14, color:"#7c3aed", cursor:"pointer", textDecoration:"underline" }}>
                👤 {curSale.customer||"Walk-in"}
              </p>
            ) : (
              <p style={{ fontWeight:700, fontSize:14, color:"#1f2937" }}>{curSale.customer||"Walk-in"}</p>
            )}
            {curSale.phone && <p style={{ fontSize:12, color:"#9ca3af" }}>📞 {curSale.phone}</p>}
          </div>
        </div>

        {/* ── Action buttons (only when admin + setSales available) ── */}
        {isAdmin && setSales && !mode && (
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            <button onClick={()=>setMode("replace")} style={{ fontSize:12, padding:"6px 14px", background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:8, cursor:"pointer", fontWeight:700, color:"#92400e" }}>🔄 Replace Item</button>
            <button onClick={()=>setMode("return")} style={{ fontSize:12, padding:"6px 14px", background:"#fef2f2", border:"1.5px solid #fecaca", borderRadius:8, cursor:"pointer", fontWeight:700, color:"#dc2626" }}>↩️ Return Items</button>
            {canUndo && <button onClick={()=>doUndo()} style={{ fontSize:12, padding:"6px 14px", background:"#fffbeb", border:"1.5px solid #fde68a", borderRadius:8, cursor:"pointer", fontWeight:700, color:"#92400e" }}>↶ Undo Last</button>}
            <button onClick={doDeleteInvoice} style={{ fontSize:12, padding:"6px 14px", background:"#fef2f2", border:"1.5px solid #fecaca", borderRadius:8, cursor:"pointer", fontWeight:700, color:"#dc2626", marginLeft:"auto" }}>🗑️ Delete Invoice</button>
          </div>
        )}

        {/* ── Inventory hint (admin only) ── */}
        {isAdmin && setInventoryNav && (
          <div style={{ display:"flex", gap:10, marginBottom:10, fontSize:11.5, color:"#6b7280" }}>
            <span style={{ padding:"2px 8px", background:"#ede9fe", color:"#7c3aed", borderRadius:6, fontWeight:600 }}>📦 In inventory</span>
            <span style={{ padding:"2px 8px", background:"#fff7ed", color:"#d97706", borderRadius:6, fontWeight:600 }}>➕ Not in inventory</span>
            <span style={{ color:"#a855f7" }}>← click to open</span>
          </div>
        )}

        {/* ── Items Table ── */}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:800, color:"#9ca3af", textTransform:"uppercase", marginBottom:8 }}>Items ({cv.type !== "original" ? "Current State" : "Purchased"})</p>
          <div style={{ border:"1.5px solid #f3f4f6", borderRadius:12, overflow:"hidden" }}>
            <div style={{ display:"grid", gridTemplateColumns: mode==="replace" ? "20px 1fr 48px 60px 80px 80px" : "1fr 48px 60px 80px 80px", background:"#f9fafb", padding:"7px 12px", fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", gap:6 }}>
              {mode==="replace" && <span></span>}
              <span>Product</span>
              <span style={{ textAlign:"center" }}>Qty</span>
              <span style={{ textAlign:"center" }}>Rate</span>
              <span style={{ textAlign:"right" }}>Disc</span>
              <span style={{ textAlign:"right" }}>Net Paid</span>
            </div>
            {cvItems.map((item, i) => {
              const mrp = item.price * item.qty;
              const iDiscRs = item.itemDiscountRs ?? (item.itemDiscount > 0 ? (item.itemDiscountType === "%" ? Math.round(mrp * item.itemDiscount / 100) : item.itemDiscount) : 0);
              const eligSub = cvItems.filter(it => !(it.itemDiscountRs > 0 || it.itemDiscount > 0)).reduce((a,b)=>a+b.price*b.qty,0);
              const bDiscOnItem = iDiscRs === 0 && eligSub > 0 ? Math.round(mrp * ((cv.billDiscount||0) / eligSub)) : 0;
              const effTotal = getEffTotal(item, cv);
              const perUnit = item.qty > 0 ? Math.round(effTotal / item.qty) : 0;
              const actualPerUnit = Math.round((effTotal * salePayRatio) / Math.max(1, item.qty));
              const settledOnItem = item.settledDisc || 0;
              const discCell = iDiscRs > 0
                ? { label: item.itemDiscountType === "%" ? `${item.itemDiscount}% = ₹${iDiscRs}` : `₹${iDiscRs}`, color:"#059669", sub:"item disc" }
                : bDiscOnItem > 0 ? { label: `₹${bDiscOnItem}`, color:"#7c3aed", sub:"bill disc" } : null;

              const prod = findProduct(item);
              const inInventory = !!prod;

              return (
                <div key={i} style={{ borderTop:"1px solid #f3f4f6", background: replaceIdx===i ? "#fff7ed" : "white" }}>
                  <div style={{ display:"grid", gridTemplateColumns: mode==="replace" ? "20px 1fr 48px 60px 80px 80px" : "1fr 48px 60px 80px 80px", padding:"10px 12px", gap:6, alignItems:"center" }}>
                    {mode==="replace" && (
                      <input type="radio" name="ri" checked={replaceIdx===i} onChange={()=>setReplaceIdx(i)} style={{ accentColor:"#f59e0b", cursor:"pointer" }} />
                    )}
                    <div>
                      <div
                        onClick={() => isAdmin && setInventoryNav && handleProductClick(item)}
                        style={{
                          fontWeight:600, fontSize:12.5,
                          display:"inline-flex", alignItems:"center", gap:4,
                          cursor: isAdmin && setInventoryNav ? "pointer" : "default",
                          color: isAdmin && setInventoryNav ? (inInventory ? "#4c1d95" : "#92400e") : "#1f2937",
                          background: isAdmin && setInventoryNav ? (inInventory ? "#f5f3ff" : "#fffbeb") : "transparent",
                          padding: isAdmin && setInventoryNav ? "2px 7px 2px 5px" : "0",
                          borderRadius: isAdmin && setInventoryNav ? 7 : 0,
                          border: isAdmin && setInventoryNav ? `1.5px dashed ${inInventory?"#c4b5fd":"#fbbf24"}` : "none",
                        }}
                      >
                        {isAdmin && setInventoryNav && <span style={{ fontSize:11 }}>{inInventory ? "📦" : "➕"}</span>}
                        {item.name}
                        {item.replacedFrom && <span style={{ fontSize:10, color:"#f59e0b", marginLeft:4 }}>🔄</span>}
                      </div>
                      <div style={{ fontSize:10.5, color:"#9ca3af", marginTop:2 }}>
                        {[item.size&&item.size!=="-"?`${item.size}`:"", item.color&&item.color!=="-"?`${item.color}`:""].filter(Boolean).join(" / ")||"—"}
                        {item.replacedFrom && <span style={{ color:"#f59e0b", display:"block" }}>was: {item.replacedFrom}</span>}
                      </div>
                    </div>
                    <span style={{ textAlign:"center", fontWeight:700, fontSize:13 }}>×{item.qty}</span>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ color:"#6b7280", fontSize:12, fontWeight:600 }}>₹{item.price}/pc</div>
                      {item.mrpPerPiece > 0 && item.mrpPerPiece !== item.price && (
                        <div style={{ fontSize:10, color:"#9ca3af", textDecoration:"line-through" }}>MRP ₹{item.mrpPerPiece}</div>
                      )}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      {discCell ? (
                        <>
                          <div style={{ fontSize:11, fontWeight:700, color:discCell.color }}>−{discCell.label}</div>
                          <div style={{ fontSize:9, color:"#9ca3af" }}>{discCell.sub}</div>
                        </>
                      ) : <span style={{ fontSize:11, color:"#e5e7eb" }}>—</span>}
                      {settledOnItem > 0 && <div style={{ fontSize:10, fontWeight:700, color:"#f59e0b", marginTop:2 }}>−₹{settledOnItem} settle</div>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:13.5, fontWeight:800, color:"#059669" }}>₹{effTotal}</div>
                      {item.qty > 1 && <div style={{ fontSize:9, color:"#9ca3af" }}>₹{perUnit}/pc</div>}
                      {mrp !== effTotal && <div style={{ fontSize:9, color:"#e5e7eb", textDecoration:"line-through" }}>₹{mrp}</div>}
                    </div>
                  </div>

                  {/* Return qty row */}
                  {mode==="return" && (
                    <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 12px 10px", padding:"8px 12px", background:"#fef2f2", borderRadius:8, flexWrap:"wrap" }}>
                      <span style={{ fontSize:11.5, color:"#dc2626", fontWeight:600 }}>Return:</span>
                      <button onClick={()=>setReturnSelected(p=>({...p,[i]:Math.max(0,(p[i]||0)-1)}))} style={{ width:24,height:24,borderRadius:5,border:"1.5px solid #fecaca",background:"white",cursor:"pointer",fontWeight:700,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>−</button>
                      <span style={{ width:24,textAlign:"center",fontWeight:800,color:"#dc2626",fontSize:14 }}>{returnSelected[i]||0}</span>
                      <button onClick={()=>setReturnSelected(p=>({...p,[i]:Math.min(item.qty,(p[i]||0)+1)}))} style={{ width:24,height:24,borderRadius:5,border:"1.5px solid #fecaca",background:"white",cursor:"pointer",fontWeight:700,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>+</button>
                      <span style={{ fontSize:10,color:"#9ca3af" }}>/ {item.qty}</span>
                      {(returnSelected[i]||0)>0 && (
                        <span style={{ fontSize:11.5,fontWeight:800,color:"#dc2626",marginLeft:"auto" }}>
                          Refund ₹{actualPerUnit * (returnSelected[i]||0)}
                          <span style={{ fontSize:9,fontWeight:400,color:"#9ca3af",display:"block" }}>₹{actualPerUnit}/pc × {returnSelected[i]}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Replace form ── */}
        {mode==="replace" && (
          <div style={{ background:"#fff7ed", border:"1.5px solid #fed7aa", borderRadius:14, padding:14, marginBottom:14 }}>
            {replaceIdx === null ? (
              <p style={{ fontSize:13, color:"#92400e", fontWeight:600, textAlign:"center" }}>👆 Upar koi item select karo (radio button)</p>
            ) : (()=>{
              const oldItem = cvItems[replaceIdx];
              const oldEffFull = getEffTotal(oldItem, cv);
              const oldActualPaid = Math.round(oldEffFull * salePayRatio);
              const shortfallOnItem = oldEffFull - oldActualPaid;
              const newP = +replaceNewPrice || 0;
              const newQ = +replaceNewQty || 1;
              const newIDisc = +replaceItemDisc || 0;
              const newEff = Math.max(0, newP * newQ - newIDisc);
              const diff = newP > 0 ? oldActualPaid - newEff : null;
              const replResults = replQuery.length >= 1
                ? products.filter(p => p.name.toLowerCase().includes(replQuery.toLowerCase()) || (p.sku||"").toLowerCase().includes(replQuery.toLowerCase())).slice(0, 6)
                : [];
              const pickRepl = (p) => { setReplaceNewName(p.name); setReplaceNewPrice(p.sellingPrice || ""); setReplQuery(p.name); setReplDropOpen(false); };
              return (
                <>
                  <p style={{ fontSize:13.5, fontWeight:800, color:"#92400e", marginBottom:8 }}>🔄 Replace: <b>{oldItem.name}</b></p>
                  <div style={{ background:"white", borderRadius:8, padding:"8px 12px", marginBottom:10, fontSize:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", color:"#6b7280" }}>
                      <span>MRP ₹{oldItem.price} × {oldItem.qty}</span><span>= ₹{oldItem.price * oldItem.qty}</span>
                    </div>
                    {(oldItem.itemDiscountRs||0) > 0 && <div style={{ display:"flex", justifyContent:"space-between", color:"#059669" }}><span>Item disc</span><span>−₹{oldItem.itemDiscountRs}</span></div>}
                    {shortfallOnItem > 0 && <div style={{ display:"flex", justifyContent:"space-between", color:"#f59e0b" }}><span>Customer ne kam diya</span><span>−₹{shortfallOnItem}</span></div>}
                    <div style={{ display:"flex", justifyContent:"space-between", fontWeight:800, color:"#dc2626", borderTop:"1px solid #f3f4f6", paddingTop:4, marginTop:4 }}>
                      <span>Customer ne actually diya</span><span>₹{oldActualPaid}</span>
                    </div>
                  </div>
                  <div style={{ position:"relative", marginBottom:6 }}>
                    <label className="label">New Item *</label>
                    <input className="input" value={replQuery}
                      onChange={e=>{ setReplQuery(e.target.value); setReplaceNewName(e.target.value); setReplDropOpen(true); }}
                      onFocus={()=>setReplDropOpen(true)}
                      onBlur={()=>setTimeout(()=>setReplDropOpen(false),200)}
                      placeholder="Naam ya SKU likhoo..." />
                    {replDropOpen && replResults.length > 0 && (
                      <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"white", border:"1.5px solid #e5e7eb", borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,0.12)", zIndex:50, maxHeight:220, overflowY:"auto" }}>
                        {replResults.map(p => (
                          <div key={p.id} onMouseDown={()=>pickRepl(p)}
                            style={{ padding:"8px 12px", cursor:"pointer", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}
                            onMouseEnter={e=>e.currentTarget.style.background="#f5f3ff"}
                            onMouseLeave={e=>e.currentTarget.style.background="white"}>
                            <div>
                              <div style={{ fontWeight:700, fontSize:13 }}>{p.name}</div>
                              {p.sku && <div style={{ fontSize:10, color:"#9ca3af" }}>SKU: {p.sku}</div>}
                            </div>
                            <div style={{ fontWeight:700, color:"#059669", fontSize:13 }}>₹{p.sellingPrice}</div>
                          </div>
                        ))}
                        {replQuery && !replResults.find(p=>p.name.toLowerCase()===replQuery.toLowerCase()) && (
                          <div onMouseDown={()=>{setReplaceNewName(replQuery);setReplDropOpen(false);}}
                            style={{ padding:"8px 12px", cursor:"pointer", color:"#d97706", fontWeight:600, fontSize:12, background:"#fffbeb" }}>
                            ➕ "{replQuery}" — custom naam use karo
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6, marginBottom:10 }}>
                    <div><label className="label">Price ₹ *</label><input className="input" type="number" onWheel={e=>e.target.blur()} value={replaceNewPrice} onChange={e=>setReplaceNewPrice(e.target.value)} placeholder="0" /></div>
                    <div><label className="label">Qty</label><input className="input" type="number" onWheel={e=>e.target.blur()} value={replaceNewQty} onChange={e=>setReplaceNewQty(e.target.value)} placeholder="1" /></div>
                    <div><label className="label">Item Disc ₹</label><input className="input" type="number" onWheel={e=>e.target.blur()} value={replaceItemDisc} onChange={e=>setReplaceItemDisc(e.target.value)} placeholder="0" /></div>
                    <div><label className="label">Size</label><input className="input" value={replaceNewSize} onChange={e=>setReplaceNewSize(e.target.value)} placeholder="M" /></div>
                  </div>
                  {diff !== null && (
                    <div style={{ borderRadius:10, padding:"10px 14px", marginBottom:10, background: diff > 0 ? "#fef2f2" : diff < 0 ? "#f0fdf4" : "#f9fafb", textAlign:"center" }}>
                      <div style={{ fontSize:13, fontWeight:700, color: diff>0?"#dc2626":diff<0?"#059669":"#6b7280" }}>
                        {diff > 0 ? `↩ Customer ko WAPIS KARO` : diff < 0 ? `➕ Customer se LENA HAI` : `✅ Barabar`}
                      </div>
                      {diff !== 0 && <div style={{ fontSize:22, fontWeight:900, color: diff>0?"#dc2626":"#059669" }}>₹{Math.abs(diff)}</div>}
                    </div>
                  )}
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={doReplace} disabled={!replaceNewName||!replaceNewPrice} className="btn" style={{ flex:1, justifyContent:"center", background:"linear-gradient(135deg,#f59e0b,#d97706)", color:"white", fontWeight:700 }}>✅ Replace Karo</button>
                    <button onClick={resetModes} className="btn btn-outline" style={{ flex:1, justifyContent:"center" }}>Cancel</button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Return summary ── */}
        {mode==="return" && (
          <div style={{ background:"#fef2f2", border:"1.5px solid #fecaca", borderRadius:14, padding:14, marginBottom:14 }}>
            {totalReturnRefund === 0 ? (
              <p style={{ fontSize:13, color:"#dc2626", fontWeight:600, textAlign:"center" }}>👆 Upar items ke saamne return qty select karo</p>
            ) : (
              <>
                <p style={{ fontSize:13.5, fontWeight:800, color:"#dc2626", marginBottom:8 }}>↩️ Return Summary</p>
                <div style={{ background:"white", borderRadius:8, padding:"8px 12px", marginBottom:10 }}>
                  {Object.entries(returnSelected).filter(([,q])=>q>0).map(([idx,qty])=>{
                    const item = cvItems[+idx]; if (!item) return null;
                    const eff = getEffTotal(item, cv);
                    const pu = item.qty > 0 ? Math.round(eff/item.qty) : 0;
                    return (
                      <div key={idx} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid #f9fafb" }}>
                        <span style={{ fontSize:12, color:"#374151" }}>{item.name} <span style={{ color:"#9ca3af" }}>×{qty} × ₹{pu}/pc</span></span>
                        <span style={{ fontWeight:800, color:"#dc2626" }}>₹{pu * qty}</span>
                      </div>
                    );
                  })}
                  <div style={{ display:"flex", justifyContent:"space-between", paddingTop:6, marginTop:4 }}>
                    <span style={{ fontWeight:800, color:"#dc2626" }}>Total Refund</span>
                    <span style={{ fontSize:18, fontWeight:900, color:"#dc2626" }}>₹{Math.round(totalReturnRefund)}</span>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={doReturn} className="btn" style={{ flex:1, justifyContent:"center", background:"linear-gradient(135deg,#dc2626,#b91c1c)", color:"white", fontWeight:700 }}>↩️ Confirm Return — Refund ₹{Math.round(totalReturnRefund)}</button>
                  <button onClick={resetModes} className="btn btn-outline" style={{ flex:1, justifyContent:"center" }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Payment Summary ── */}
        <div style={{ background:"#f9fafb", borderRadius:14, padding:"14px 18px", marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:800, color:"#9ca3af", textTransform:"uppercase", marginBottom:10 }}>💳 Payment Summary</p>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {(() => {
              const s = calcBillSummary(cv);
              const hasMRP = s.mrpDiscount > 0;
              return (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color: hasMRP ? "#9ca3af" : "#6b7280" }}>
                    <span>Subtotal ({cvItems.reduce((a,b)=>a+(b.qty||1),0)} items)</span>
                    <span style={{ fontWeight:600, color:"#1f2937", textDecoration: hasMRP ? "line-through" : "none" }}>₹{s.mrpSubtotal.toLocaleString()}</span>
                  </div>
                  {hasMRP && cvItems.filter(it=>it.mrpPerPiece>it.price).map((it,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#d97706", paddingLeft:10 }}>
                      <span>↳ {it.name}{it.sku?` [${it.sku}]`:""} {it.size&&it.size!=="-"?`(${it.size})`:""} MRP ₹{it.mrpPerPiece}×{it.qty}</span>
                      <span style={{ fontWeight:700 }}>−₹{(it.mrpPerPiece-it.price)*(it.qty||1)}</span>
                    </div>
                  ))}
                  {hasMRP && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#d97706", fontWeight:700 }}><span>🏷️ MRP se sasta</span><span>−₹{s.mrpDiscount.toLocaleString()}</span></div>}
                  {hasMRP && <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#374151", fontWeight:600 }}><span>Rate Subtotal</span><span>₹{s.rateSubtotal.toLocaleString()}</span></div>}
                  {s.itemDiscTotal > 0 && (
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#059669" }}><span>🏷️ Item Discount</span><span style={{ fontWeight:700 }}>−₹{s.itemDiscTotal}</span></div>
                      {cvItems.filter(it=>(it.itemDiscountRs||0)>0).map((it,i)=>(
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#9ca3af", paddingLeft:14 }}>
                          <span>↳ {it.name}{it.sku?` [${it.sku}]`:""} {it.size&&it.size!=="-"?`(${it.size})`:""} ×{it.qty||1}</span>
                          <span style={{ color:"#059669" }}>−₹{it.itemDiscountRs}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.billDiscAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#7c3aed" }}><span>Bill Discount</span><span style={{ fontWeight:700 }}>−₹{s.billDiscAmt}</span></div>}
                  {s.legacyDisc > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#059669" }}><span>🏷️ Discount</span><span style={{ fontWeight:700 }}>−₹{s.legacyDisc}</span></div>}
                  {s.settledTotal > 0 && (
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#f59e0b" }}><span>📉 Customer ne kam diya</span><span style={{ fontWeight:700 }}>−₹{s.settledTotal}</span></div>
                      {cvItems.filter(it=>(it.settledDisc||0)>0).map((it,i)=>(
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#9ca3af", paddingLeft:14 }}>
                          <span>↳ {it.name}</span><span style={{ color:"#f59e0b" }}>−₹{it.settledDisc}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.taxAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#d97706" }}><span>GST</span><span style={{ fontWeight:700 }}>+₹{s.taxAmt}</span></div>}
                  {origShortfall > 0 && (
                    <>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#374151", borderTop:"1px dashed #e5e7eb", paddingTop:5 }}><span>Original Bill Total</span><span style={{ fontWeight:600 }}>₹{v0Total.toLocaleString()}</span></div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}><span style={{ color:"#f59e0b", fontWeight:600 }}>⬇️ Customer ne kam diya</span><span style={{ fontWeight:800, color:"#f59e0b" }}>−₹{origShortfall}</span></div>
                    </>
                  )}
                  {cv.type === "return" && cv.note && <div style={{ fontSize:11, color:"#dc2626", background:"#fef2f2", padding:"5px 10px", borderRadius:7, fontStyle:"italic", marginTop:2 }}>↩️ {cv.note}</div>}
                  {cv.type === "replace" && cv.note && <div style={{ fontSize:11, color:"#d97706", background:"#fff7ed", padding:"5px 10px", borderRadius:7, fontStyle:"italic", marginTop:2 }}>🔄 {cv.note}</div>}
                </>
              );
            })()}

            {/* ── Final paid ── */}
            <div style={{ borderTop:"2px solid #e5e7eb", paddingTop:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:15, fontWeight:800, color:"#111827" }}>✅ Amount Paid</span>
              <span style={{ fontSize:22, fontWeight:900, color:"#059669" }}>₹{Math.round(receivedAmt).toLocaleString()}</span>
            </div>

            {/* ── Net Savings ── */}
            {(() => {
              const s = calcBillSummary(cv);
              // totalSavings ab settledTotal include karta hai — origShortfall alag add nahi karo
              const netSavings = s.totalSavings;
              if (netSavings <= 0) return null;
              return (
                <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:"10px 14px", marginTop:4 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#15803d", textTransform:"uppercase", marginBottom:6 }}>💰 Customer ki Total Savings</div>
                  {s.mrpDiscount > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}><span>MRP se sasta</span><span style={{ color:"#d97706", fontWeight:700 }}>−₹{s.mrpDiscount}</span></div>}
                  {s.itemDiscTotal > 0 && (
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}><span>Item discount</span><span style={{ color:"#059669", fontWeight:700 }}>−₹{s.itemDiscTotal}</span></div>
                      {cvItems.filter(it=>(it.itemDiscountRs||0)>0).map((it,i)=>(
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#9ca3af", paddingLeft:12 }}>
                          <span>↳ {it.name}{it.sku?` [${it.sku}]`:""} {it.size&&it.size!=="-"?`(${it.size})`:""} {it.qty>1?`×${it.qty}`:""}</span>
                          <span style={{ color:"#059669" }}>−₹{it.itemDiscountRs}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.billDiscAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}><span>Bill discount</span><span style={{ color:"#7c3aed", fontWeight:700 }}>−₹{s.billDiscAmt}</span></div>}
                  {s.legacyDisc > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}><span>Discount</span><span style={{ color:"#059669", fontWeight:700 }}>−₹{s.legacyDisc}</span></div>}
                  {s.settledTotal > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}><span>Less kiya (extra bachat)</span><span style={{ color:"#15803d", fontWeight:700 }}>−₹{s.settledTotal}</span></div>}
                  <div style={{ borderTop:"1px dashed #86efac", marginTop:6, paddingTop:6, display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:800, color:"#15803d" }}>
                    <span>Total Bachaya</span><span>−₹{netSavings}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <BillActions bill={{...curSale, ...cv, items: cvItems}} shopName={shopName} onClose={onClose} showNewBill={false} />
      </div>
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [highlightPhone, setHighlightPhone] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Global invoice drawer — any component can open an invoice
  const [globalInvoiceSale, setGlobalInvoiceSale] = useState(null);
  // Inventory auto-navigate: open product edit (id) OR pre-fill add form (prefill obj)
  const [inventoryNav, setInventoryNav] = useState(null); // { type: "edit"|"add", productId?, prefill? }
  const [products, setProductsState] = useState(INITIAL_PRODUCTS);
  const [sales, setSalesState] = useState(INITIAL_SALES);
  const [purchases, setPurchasesState] = useState(INITIAL_PURCHASES);
  const [customers, setCustomersState] = useState(INITIAL_CUSTOMERS);
  const [toast, setToast] = useState(null);
  // BUG23 FIX: multi-tab warning state
  const [showMultiTabAlert, setShowMultiTabAlert] = React.useState(multiTabWarning);
  const [shopName, setShopName] = useState(() => {
    try { return localStorage.getItem('shopName') || "JB Fashion"; } catch { return "JB Fashion"; }
  });
  const [billCounter, setBillCounterState] = useState(5);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingQueue, setPendingQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fp_offline_queue") || "[]"); } catch { return []; }
  });

  // ── Track online/offline status ──
  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // ── When internet comes back — flush pending queue to Firebase ──
  useEffect(() => {
    if (!isOnline) return;
    const queue = (() => { try { return JSON.parse(localStorage.getItem("fp_offline_queue") || "[]"); } catch { return []; }})();
    if (queue.length === 0) return;

    const flush = async () => {
      const batch = writeBatch(db);
      queue.forEach(op => {
        if (op.type === "set") {
          batch.set(doc(db, op.col, String(op.item.id)), op.item);
        } else if (op.type === "delete") {
          batch.delete(doc(db, op.col, String(op.id)));
        } else if (op.type === "meta") {
          batch.set(doc(db, "meta", op.key), op.value);
        }
      });
      try {
        await batch.commit();
        localStorage.removeItem("fp_offline_queue");
        setPendingQueue([]);
        showToast(`✅ ${queue.length} pending changes synced to Firebase!`, "success");
      } catch(e) {
        console.error("Queue flush error:", e);
      }
    };
    flush();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // ── Queue helper — add operation to pending queue ──
  // eslint-disable-next-line no-unused-vars
  const addToQueue = (op) => {
    const q = (() => { try { return JSON.parse(localStorage.getItem("fp_offline_queue") || "[]"); } catch { return []; }})();
    // Deduplicate: replace existing op for same col+id
    const filtered = q.filter(o => !(o.col === op.col && o.type === op.type && String(o.item?.id) === String(op.item?.id)));
    const newQ = [...filtered, op];
    localStorage.setItem("fp_offline_queue", JSON.stringify(newQ));
    setPendingQueue(newQ);
  };
  const [customSizes, setCustomSizesState] = useState([]);
  const [fbLoaded, setFbLoaded] = useState({ products: false, sales: false, purchases: false, customers: false });

  // ── Firebase real-time listeners ──
  useEffect(() => {
    const unsubs = [];
    const listen = (colName, setter, key) => {
      // Load from localStorage cache immediately (works offline)
      try {
        const cached = localStorage.getItem("fp_cache_" + colName);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.length > 0) setter(parsed);
        }
      } catch {}

      const unsub = onSnapshot(collection(db, colName), { includeMetadataChanges: false }, snap => {
        const data = snap.docs.map(d => d.data()).filter(Boolean);
        if (data.length > 0) {
          setter(data);
          // Save to localStorage cache for offline use
          try { localStorage.setItem("fp_cache_" + colName, JSON.stringify(data)); } catch {}
        } else if (snap.docs.length === 0) {
          // Collection was emptied (e.g. after delete) — reset state too
          setter([]);
          try { localStorage.removeItem("fp_cache_" + colName); } catch {}
        }
        setFbLoaded(prev => ({ ...prev, [key]: true }));
      }, err => {
        console.error("Firebase listener error:", err);
        setFbLoaded(prev => ({ ...prev, [key]: true }));
      });
      unsubs.push(unsub);
    };
    listen("products", setProductsState, "products");
    listen("sales", setSalesState, "sales");
    listen("purchases", setPurchasesState, "purchases");
    listen("customers", setCustomersState, "customers");
    // billCounter
    const unsub = onSnapshot(doc(db, "meta", "billCounter"), snap => {
      if (snap.exists()) setBillCounterState(snap.data().value || 5);
    }, () => {});
    unsubs.push(unsub);
    // customSizes
    const unsub2 = onSnapshot(doc(db, "meta", "customSizes"), snap => {
      if (snap.exists()) setCustomSizesState(snap.data().sizes || []);
    }, () => {});
    unsubs.push(unsub2);
    return () => unsubs.forEach(u => u());
  }, []);

  // ── Wrapped setters that also save to Firebase ──
  const cacheLocal = (key, data) => { try { localStorage.setItem("fp_cache_" + key, JSON.stringify(data)); } catch {} };

  // BUG20 FIX: smart save — agar prev se compare karo, sirf changed items save karo
  // Ek product edit pe 500 writes nahi — sirf 1 write
  const smartSave = (colName, prev, next) => {
    if (!Array.isArray(prev) || !Array.isArray(next)) {
      saveCollection(colName, next);
      return;
    }
    const prevMap = {};
    prev.forEach(item => { prevMap[item.id] = item; });
    const changed = next.filter(item => {
      const old = prevMap[item.id];
      return !old || JSON.stringify(old) !== JSON.stringify(item);
    });
    const deleted = prev.filter(item => !next.find(n => n.id === item.id));
    // Agar bahut zyada changes (e.g. bulk restore) — full collection save
    if (changed.length > 20 || deleted.length > 5) {
      saveCollection(colName, next);
    } else {
      changed.forEach(item => saveSingle(colName, item));
      deleted.forEach(item => deleteFromCol(colName, item.id));
    }
  };

  const setProducts = (val) => {
    setProductsState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      cacheLocal("products", next);
      smartSave("products", prev, next);
      return next;
    });
  };
  const setSales = (val) => {
    setSalesState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      cacheLocal("sales", next);
      smartSave("sales", prev, next);
      return next;
    });
  };
  const setPurchases = (val) => {
    setPurchasesState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      cacheLocal("purchases", next);
      smartSave("purchases", prev, next);
      return next;
    });
  };
  const setCustomers = (val) => {
    setCustomersState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      cacheLocal("customers", next);
      smartSave("customers", prev, next);
      return next;
    });
  };
  const setBillCounter = (val) => {
    setBillCounterState(val);
    setDoc(doc(db, "meta", "billCounter"), { value: val }).catch(console.error);
  };
  const setCustomSizes = (val) => {
    setCustomSizesState(val);
    setDoc(doc(db, "meta", "customSizes"), { sizes: val }).catch(console.error);
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Show loading while Firebase connects (only first time)
  const allLoaded = Object.values(fbLoaded).every(Boolean);
  if (!allLoaded) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#6d28d9,#4f46e5)", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>🛍️</div>
      <div style={{ color: "white", fontSize: 28, fontWeight: 800, marginBottom: 8 }}>JB Fashion</div>
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 15, marginBottom: 32 }}>Data load ho raha hai...</div>
      <div style={{ width: 48, height: 48, border: "4px solid rgba(255,255,255,0.2)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!loggedIn) return <LoginScreen onLogin={u => { setCurrentUser(u); setLoggedIn(true); }} />;

  const isAdmin = currentUser?.role === "admin";

  // Auto SKU generator — alphabetical sequence: a,b,...z, aa,ab,...az, ba,...zz, aaa,...
  const generateSKU = (allProducts) => {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    const existingSKUs = new Set(allProducts.map(p => (p.sku || "").toLowerCase()));
    const toCode = (n) => {
      let code = "";
      n = n + 1;
      while (n > 0) {
        n--;
        code = chars[n % 26] + code;
        n = Math.floor(n / 26);
      }
      return code;
    };
    let i = 0;
    while (true) {
      const candidate = toCode(i);
      if (!existingSKUs.has(candidate)) return candidate;
      i++;
    }
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard", adminOnly: true },
    { id: "inventory", label: "Inventory", icon: "inventory", adminOnly: false },
    { id: "billing", label: "Billing / POS", icon: "billing", adminOnly: false },
    { id: "billhistory", label: "Bill History", icon: "tag", adminOnly: false },
    { id: "purchases", label: "Purchases", icon: "purchases", adminOnly: true },
    { id: "customers", label: "Customers", icon: "customers", adminOnly: false },
    { id: "productsearch", label: "🔍 Product Lookup", icon: "search", adminOnly: false },
    { id: "reports", label: "Reports", icon: "reports", adminOnly: true },
    { id: "margin", label: "💰 Margin", icon: "reports", adminOnly: true },
    { id: "broadcast", label: "WA Broadcast", icon: "whatsapp", adminOnly: true },
    { id: "settings", label: "Settings", icon: "settings", adminOnly: true },
  ];

  // BUG49 FIX: size-variant products mein koi bhi size low ho toh alert
  // Sirf total quantity check karna galat tha — M=0, L=20 → alert nahi aata tha
  const LOW_STOCK_THRESHOLD = 5;
  const lowStockProducts = products.filter(p => {
    if (p.pricingType === "size-variant" && p.sizeVariants?.length) {
      // Koi bhi size variant low stock mein ho
      return p.sizeVariants.some(sv => (sv.stock || 0) <= LOW_STOCK_THRESHOLD);
    }
    return p.quantity <= LOW_STOCK_THRESHOLD;
  });
  const getCV = (s) => { if (!s) return {}; return (s.versions && s.versions.length > 0) ? (s.versions[s.currentVersion ?? s.versions.length - 1] || s.versions[0] || s) : s; };
  const todaySales = sales.filter(s => ((getCV(s).date || s.date) || "").slice(0, 10) === getISTDateStr()) // BUG25 FIX: IST
    .sort((a,b) => (getCV(b).date||b.date||"").localeCompare(getCV(a).date||a.date||"")||b.id-a.id);
  const todayRevenue = todaySales.reduce((a, b) => a + getCV(b).total, 0);
  const totalRevenue = sales.reduce((a, b) => a + getCV(b).total, 0);
  const getItemPurchaseCost = (d) => {
    const p = products.find(x => x.id === d.productId || x.name === d.name);
    if (!p) return 0;
    if (p.pricingType === "size-variant" && d.size && d.size !== "-") {
      const sv = p.sizeVariants?.find(s => s.size === d.size);
      if (sv) return (sv.purchasePrice || 0) * d.qty;
    }
    return (p.purchasePrice || 0) * d.qty;
  };
  const totalCost = sales.reduce((a, b) => {
    const items = getCV(b).items || b.items || [];
    return a + items.reduce((c, d) => c + getItemPurchaseCost(d), 0);
  }, 0);
  const totalProfit = totalRevenue - totalCost;

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Playfair+Display:wght@600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #f0f0f0; }
    ::-webkit-scrollbar-thumb { background: #c5b4e3; border-radius: 10px; }
    @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
    @keyframes toastIn { from { opacity:0; transform:translateY(-20px); } to { opacity:1; transform:translateY(0); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
    .page { animation: slideIn 0.3s ease; }
    .nav-item { display:flex; align-items:center; gap:10px; padding:11px 16px; border-radius:12px; cursor:pointer; color:rgba(255,255,255,0.55); font-size:13.5px; font-weight:500; transition:all 0.2s; text-decoration:none; border:none; background:none; width:100%; }
    .nav-item:hover { background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.9); }
    .nav-item.active { background:linear-gradient(135deg,rgba(240,147,251,0.2),rgba(245,87,108,0.2)); color:white; border:1px solid rgba(240,147,251,0.25); }
    .card { background:white; border-radius:16px; padding:20px; box-shadow:0 2px 12px rgba(0,0,0,0.06); border:1px solid #f0eef8; }
    .stat-card { background:white; border-radius:16px; padding:22px; box-shadow:0 2px 12px rgba(0,0,0,0.06); border:1px solid #f0eef8; transition:transform 0.2s; cursor:default; }
    .stat-card:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,0.1); }
    .btn { padding:10px 18px; border-radius:10px; border:none; cursor:pointer; font-size:13.5px; font-weight:600; display:inline-flex; align-items:center; gap:7px; transition:all 0.2s; font-family:'DM Sans',sans-serif; }
    .btn-primary { background:linear-gradient(135deg,#7c3aed,#a855f7); color:white; }
    .btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 20px rgba(124,58,237,0.35); }
    .btn-danger { background:#fee2e2; color:#dc2626; }
    .btn-danger:hover { background:#fecaca; }
    .btn-success { background:linear-gradient(135deg,#059669,#10b981); color:white; }
    .btn-success:hover { transform:translateY(-1px); box-shadow:0 6px 20px rgba(16,185,129,0.35); }
    .btn-outline { background:white; color:#7c3aed; border:1.5px solid #a855f7; }
    .btn-outline:hover { background:#f5f3ff; }
    .btn-sm { padding:7px 12px; font-size:12.5px; }
    .input { width:100%; padding:10px 14px; border:1.5px solid #e5e7eb; border-radius:10px; font-size:14px; outline:none; transition:border 0.2s; font-family:'DM Sans',sans-serif; color:#1f2937; background:white; }
    .input:focus { border-color:#a855f7; box-shadow:0 0 0 3px rgba(168,85,247,0.1); }
    .select { width:100%; padding:10px 14px; border:1.5px solid #e5e7eb; border-radius:10px; font-size:14px; outline:none; font-family:'DM Sans',sans-serif; color:#1f2937; background:white; cursor:pointer; }
    .select:focus { border-color:#a855f7; }
    .label { font-size:12px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:5px; }
    .table { width:100%; border-collapse:collapse; font-size:13.5px; }
    .table th { text-align:left; padding:12px 14px; font-size:11.5px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #f3f4f6; white-space:nowrap; }
    .table td { padding:12px 14px; border-bottom:1px solid #f9fafb; color:#374151; vertical-align:middle; }
    .table tr:hover td { background:#fafafa; }
    .badge { padding:3px 10px; border-radius:20px; font-size:11.5px; font-weight:600; display:inline-block; }
    .badge-green { background:#d1fae5; color:#059669; }
    .badge-red { background:#fee2e2; color:#dc2626; }
    .badge-yellow { background:#fef3c7; color:#d97706; }
    .badge-blue { background:#dbeafe; color:#2563eb; }
    .badge-purple { background:#ede9fe; color:#7c3aed; }
    .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; backdrop-filter:blur(4px); padding:16px; }
    .modal { background:white; border-radius:20px; padding:24px; width:100%; max-width:560px; max-height:90vh; overflow-y:auto; box-shadow:0 25px 60px rgba(0,0,0,0.2); animation:slideIn 0.3s ease; }
    .form-row { display:grid; gap:14px; }
    .form-row-2 { grid-template-columns:1fr 1fr; }
    .form-row-3 { grid-template-columns:1fr 1fr 1fr; }
    .search-bar { position:relative; }
    .search-bar input { padding-left:40px; }
    .search-bar svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#9ca3af; }
    .low-stock-badge { background:#fff1f2; color:#e11d48; border:1px solid #fecdd3; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700; animation: pulse 2s infinite; }
    @keyframes sidebarSlide { from { opacity:0; } to { opacity:1; } }

    /* ── DESKTOP sidebar ── */
    .sidebar { background:linear-gradient(180deg,#1e1b4b,#312e81); display:flex; flex-direction:column; min-height:100vh; position:fixed; top:0; left:0; bottom:0; overflow-y:auto; overflow-x:hidden; z-index:100; transition: width 0.25s cubic-bezier(0.4,0,0.2,1); }
    .sidebar.open { width:230px; padding:20px 12px; }
    .sidebar.closed { width:64px; padding:16px 8px; }
    .main-content { min-height:100vh; background:#f8f7fe; display:flex; flex-direction:column; transition: margin-left 0.25s cubic-bezier(0.4,0,0.2,1); }
    .main-content.open { margin-left:230px; }
    .main-content.closed { margin-left:64px; }
    .topbar { background:white; border-bottom:1px solid #f0eef8; padding:14px 28px; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; z-index:50; }
    .page-content { padding:24px 28px; flex:1; }
    .toggle-btn { width:36px; height:36px; border-radius:10px; border:none; background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.8); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s; flex-shrink:0; }
    .toggle-btn:hover { background:rgba(255,255,255,0.2); color:white; }
    .nav-label-text { overflow:hidden; white-space:nowrap; transition: opacity 0.2s, width 0.2s; }
    .sidebar.open .nav-label-text { opacity:1; width:auto; }
    .sidebar.closed .nav-label-text { opacity:0; width:0; }
    .nav-item { display:flex; align-items:center; gap:10px; padding:11px 10px; border-radius:12px; cursor:pointer; color:rgba(255,255,255,0.55); font-size:13.5px; font-weight:500; transition:all 0.2s; border:none; background:none; width:100%; white-space:nowrap; overflow:hidden; }
    .nav-item:hover { background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.9); }
    .nav-item.active { background:linear-gradient(135deg,rgba(240,147,251,0.2),rgba(245,87,108,0.2)); color:white; border:1px solid rgba(240,147,251,0.25); }
    .sidebar-logo-text { overflow:hidden; white-space:nowrap; transition: opacity 0.2s; }
    .sidebar.open .sidebar-logo-text { opacity:1; }
    .sidebar.closed .sidebar-logo-text { opacity:0; width:0; pointer-events:none; }
    .sidebar-topbar-toggle { display:flex; align-items:center; justify-content:space-between; padding-bottom:20px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:16px; }
    .sidebar.closed .sidebar-topbar-toggle { justify-content:center; }
    .mobile-bottom-nav { display:none; }
    .mobile-topbar { display:none; }
    .desktop-sidebar { display:flex; }

    /* ── MOBILE (≤768px) ── */
    @media (max-width:768px) {
      .form-row-2 { grid-template-columns:1fr; }
      .form-row-3 { grid-template-columns:1fr; }

      /* Hide desktop sidebar */
      .desktop-sidebar { display:none !important; }

      /* Hide desktop topbar */
      .topbar { display:none !important; }

      /* Main content full width + bottom padding for nav */
      .main-content { margin-left:0 !important; padding-bottom:70px; }

      /* Compact topbar */
      .page-content { padding:12px 12px 84px; }

      /* Mobile top header bar */
      .mobile-topbar {
        display:flex; align-items:center; justify-content:space-between;
        background:linear-gradient(135deg,#1e1b4b,#312e81);
        padding:12px 16px;
        position:sticky; top:0; z-index:90;
      }

      /* Bottom nav bar */
      .mobile-bottom-nav {
        display:flex;
        position:fixed; bottom:0; left:0; right:0; z-index:200;
        background:white;
        border-top:1.5px solid #ede9fe;
        box-shadow:0 -4px 20px rgba(124,58,237,0.12);
        padding:6px 0 env(safe-area-inset-bottom,6px);
      }
      .mob-nav-item {
        flex:1; display:flex; flex-direction:column; align-items:center; position:relative;
        gap:3px; padding:6px 4px; cursor:pointer; border:none; background:none;
        font-family:'DM Sans',sans-serif;
        transition:all 0.15s;
      }
      .mob-nav-item .mob-icon { font-size:20px; line-height:1; transition:transform 0.15s; }
      .mob-nav-item .mob-label { font-size:9.5px; font-weight:600; color:#9ca3af; letter-spacing:0.2px; }
      .mob-nav-item.active .mob-icon { transform:translateY(-2px); }
      .mob-nav-item.active .mob-label { color:#7c3aed; }

      /* Modal full-screen bottom sheet on mobile */
      .modal-overlay { padding:0; align-items:flex-end; }
      .modal { border-radius:20px 20px 0 0; max-height:92vh; padding:20px 16px 30px; }

      /* Card padding */
      .card { padding:12px; border-radius:14px; }
      .stat-card { padding:12px; border-radius:14px; }

      /* Table scroll */
      .table-scroll-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
    }

    /* ── SMALL PHONE (≤400px) ── */
    @media (max-width:400px) {
      .page-content { padding:10px 10px 84px; }
      .btn { padding:9px 12px; font-size:12px; }
      .input, .select { font-size:13px; padding:9px 11px; }
    }
    /* Responsive 2-col grids */
    .grid-2col { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
    @media (max-width:768px) { .grid-2col { grid-template-columns:1fr !important; gap:14px !important; } }
  `;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <style>{styles}</style>

      {/* BUG23 FIX: Multi-tab warning banner — console warn ki jagah visible UI alert */}
      {showMultiTabAlert && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000, background: "#b45309", color: "white", padding: "10px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>⚠️ Multiple tabs open hain — Data conflict ho sakta hai! Sirf ek tab mein FashionPro chalao.</span>
          <button onClick={() => setShowMultiTabAlert(false)} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "white", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: toast.type === "success" ? "#059669" : "#dc2626", color: "white", padding: "12px 20px", borderRadius: 12, fontSize: 14, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", gap: 8, animation: "toastIn 0.3s ease" }}>
          <Icon name={toast.type === "success" ? "check" : "alert"} size={16} />
          {toast.msg}
        </div>
      )}

      {/* SIDEBAR — Desktop only */}
      <div className={`sidebar desktop-sidebar ${sidebarOpen ? "open" : "closed"}`}>

        {/* Top: Logo + Toggle Button */}
        <div className="sidebar-topbar-toggle">
          {sidebarOpen && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#f093fb,#f5576c)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>👔</div>
              <div className="sidebar-logo-text">
                <div style={{ color: "white", fontWeight: 700, fontSize: 13, fontFamily: "'Playfair Display', serif", lineHeight: 1.2 }}>FashionPro</div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>Management</div>
              </div>
            </div>
          )}
          {!sidebarOpen && (
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#f093fb,#f5576c)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👔</div>
          )}
          <button
            className="toggle-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Sidebar band karo" : "Sidebar kholo"}
            style={{ marginLeft: sidebarOpen ? 0 : "auto" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {sidebarOpen
                ? <><line x1="18" y1="6" x2="6" y2="6"/><line x1="18" y1="12" x2="6" y2="12"/><line x1="18" y1="18" x2="6" y2="18"/></>
                : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
              }
            </svg>
          </button>
        </div>

        {/* Nav Items */}
        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          {navItems.map(item => {
            const locked = item.adminOnly && !isAdmin;
            return (
              <button
                key={item.id}
                className={`nav-item ${activeTab === item.id ? "active" : ""} ${locked ? "locked-nav" : ""}`}
                onClick={() => { if (locked) { showToast("Sirf Admin dekh sakta hai yeh section 🔒", "error"); return; } setActiveTab(item.id); }}
                title={!sidebarOpen ? (locked ? `${item.label} (Admin Only)` : item.label) : ""}
                style={{ justifyContent: sidebarOpen ? "flex-start" : "center", padding: sidebarOpen ? "11px 12px" : "11px 0", position: "relative", opacity: locked ? 0.45 : 1 }}
              >
                <span style={{ flexShrink: 0, display: "flex" }}><Icon name={item.icon} size={18} /></span>
                {sidebarOpen && (
                  <span className="nav-label-text" style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
                )}
                {locked && sidebarOpen && (
                  <span style={{ marginLeft: "auto", fontSize: 13 }}>🔒</span>
                )}
                {item.id === "inventory" && lowStockProducts.length > 0 && sidebarOpen && !locked && (
                  <span style={{ marginLeft: "auto", background: "#f5576c", color: "white", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, flexShrink: 0 }}>{lowStockProducts.length}</span>
                )}
                {item.id === "inventory" && lowStockProducts.length > 0 && !sidebarOpen && !locked && (
                  <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, background: "#f5576c", borderRadius: "50%" }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 12, marginTop: 12 }}>
          <button
            className="nav-item"
            onClick={() => setLoggedIn(false)}
            title={!sidebarOpen ? "Logout" : ""}
            style={{ justifyContent: sidebarOpen ? "flex-start" : "center", padding: sidebarOpen ? "11px 12px" : "11px 0" }}
          >
            <span style={{ flexShrink: 0, display: "flex" }}><Icon name="logout" size={18} /></span>
            {sidebarOpen && <span className="nav-label-text">Logout</span>}
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div className={`main-content ${sidebarOpen ? "open" : "closed"}`}>

        {/* ── MOBILE TOP BAR ── */}
        <div className="mobile-topbar">
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, background:"linear-gradient(135deg,#f093fb,#f5576c)", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>👔</div>
            <div>
              <div style={{ color:"white", fontWeight:700, fontSize:13, fontFamily:"'Playfair Display', serif" }}>FashionPro</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10 }}>{navItems.find(n => n.id === activeTab)?.label}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {!isOnline && (
              <div style={{ background:"#fff7ed", color:"#d97706", borderRadius:8, padding:"4px 8px", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", gap:4 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"#f97316" }} />
                Offline{pendingQueue.length > 0 ? ` · ${pendingQueue.length}` : ""}
              </div>
            )}
            {isOnline && pendingQueue.length > 0 && (
              <div style={{ background:"#ecfdf5", color:"#059669", borderRadius:8, padding:"4px 8px", fontSize:11, fontWeight:700 }}>
                ↑ Syncing...
              </div>
            )}
            {lowStockProducts.length > 0 && (
              <div onClick={() => setActiveTab("inventory")} style={{ background:"#fee2e2", color:"#dc2626", borderRadius:8, padding:"4px 8px", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                ⚠️ {lowStockProducts.length}
              </div>
            )}
            <div style={{ width:28, height:28, background:isAdmin?"linear-gradient(135deg,#7c3aed,#a855f7)":"linear-gradient(135deg,#059669,#10b981)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:12, fontWeight:700 }}>
              {currentUser?.name?.charAt(0)}
            </div>
          </div>
        </div>

        {/* Desktop topbar */}
        <div className="topbar" style={{ display:"flex" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Sidebar band karo" : "Sidebar kholo"}
              style={{ width: 38, height: 38, borderRadius: 10, border: "1.5px solid #e5e7eb", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#7c3aed", flexShrink: 0, transition: "all 0.2s" }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1f2937" }}>{navItems.find(n => n.id === activeTab)?.label}</h2>
              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* ── Online / Offline indicator ── */}
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 12px", borderRadius:10, fontSize:12.5, fontWeight:600, background: isOnline ? "#ecfdf5" : "#fff7ed", color: isOnline ? "#059669" : "#d97706", border: `1px solid ${isOnline ? "#bbf7d0" : "#fed7aa"}`, transition:"all 0.3s" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: isOnline ? "#22c55e" : "#f97316", boxShadow: isOnline ? "0 0 6px #22c55e" : "0 0 6px #f97316" }} />
              {isOnline ? "Online" : "Offline"}
              {pendingQueue.length > 0 && (
                <span style={{ marginLeft:4, background:"#f97316", color:"white", borderRadius:8, padding:"1px 7px", fontSize:11 }}>
                  {pendingQueue.length} pending
                </span>
              )}
            </div>
            {lowStockProducts.length > 0 && (
              <div onClick={() => setActiveTab("inventory")} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff1f2", color: "#e11d48", padding: "7px 12px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 600, border: "1px solid #fecdd3" }}>
                <Icon name="alert" size={14} /> {lowStockProducts.length} Low Stock
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: isAdmin ? "#f5f3ff" : "#ecfdf5", padding: "7px 14px", borderRadius: 10 }}>
              <div style={{ width: 30, height: 30, background: isAdmin ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "linear-gradient(135deg,#059669,#10b981)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 13, fontWeight: 700 }}>{currentUser?.name?.charAt(0)}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>{currentUser?.name}</div>
                <div style={{ fontSize: 11, color: isAdmin ? "#7c3aed" : "#059669", fontWeight: 600 }}>{isAdmin ? "👑 Admin" : "👤 Staff"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Offline banner ── */}
        {!isOnline && (
          <div style={{ background:"linear-gradient(90deg,#fff7ed,#fffbeb)", borderBottom:"2px solid #fed7aa", padding:"8px 20px", display:"flex", alignItems:"center", gap:10, fontSize:13 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:"#f97316", boxShadow:"0 0 8px #f97316", flexShrink:0 }} />
            <span style={{ fontWeight:700, color:"#c2410c" }}>Internet nahi hai — Offline Mode</span>
            <span style={{ color:"#9a3412" }}>Bills, products, purchases sab save ho rahe hain PC mein. Internet aate hi Firebase pe auto-sync ho jaayega.</span>
            {pendingQueue.length > 0 && <span style={{ marginLeft:"auto", background:"#f97316", color:"white", borderRadius:8, padding:"2px 10px", fontWeight:700, fontSize:12 }}>{pendingQueue.length} changes pending sync</span>}
          </div>
        )}
        {isOnline && pendingQueue.length > 0 && (
          <div style={{ background:"linear-gradient(90deg,#ecfdf5,#f0fdf4)", borderBottom:"2px solid #bbf7d0", padding:"8px 20px", display:"flex", alignItems:"center", gap:10, fontSize:13 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:"#22c55e", boxShadow:"0 0 8px #22c55e", flexShrink:0, animation:"pulse 1s infinite" }} />
            <span style={{ fontWeight:700, color:"#166534" }}>Internet wapas aa gaya!</span>
            <span style={{ color:"#14532d" }}>Pending {pendingQueue.length} changes Firebase pe sync ho rahe hain...</span>
          </div>
        )}
        <div className="page-content">
          {activeTab === "dashboard" && (isAdmin ? <Dashboard products={products} sales={sales} purchases={purchases} totalRevenue={totalRevenue} totalProfit={totalProfit} todayRevenue={todayRevenue} todaySales={todaySales} lowStockProducts={lowStockProducts} setActiveTab={setActiveTab} shopName={shopName} setGlobalInvoiceSale={setGlobalInvoiceSale} /> : <StaffBlocked />)}
          {activeTab === "inventory" && <Inventory products={products} setProducts={setProducts} showToast={showToast} lowStockProducts={lowStockProducts} isAdmin={isAdmin} generateSKU={generateSKU} customSizes={customSizes} inventoryNav={inventoryNav} setInventoryNav={setInventoryNav} />}
          {activeTab === "billing" && <Billing products={products} setProducts={setProducts} sales={sales} setSales={setSales} customers={customers} setCustomers={setCustomers} showToast={showToast} billCounter={billCounter} setBillCounter={setBillCounter} shopName={shopName} isAdmin={isAdmin} setActiveTab={setActiveTab} setHighlightPhone={setHighlightPhone} setGlobalInvoiceSale={setGlobalInvoiceSale} />}
          {activeTab === "billhistory" && <BillHistory sales={sales} setSales={setSales} products={products} setProducts={setProducts} customers={customers} setCustomers={setCustomers} billCounter={billCounter} setBillCounter={setBillCounter} shopName={shopName} isAdmin={isAdmin} setActiveTab={setActiveTab} setHighlightPhone={setHighlightPhone} setGlobalInvoiceSale={setGlobalInvoiceSale} />}
          {activeTab === "purchases" && (isAdmin ? <Purchases purchases={purchases} setPurchases={setPurchases} products={products} setProducts={setProducts} showToast={showToast} /> : <StaffBlocked />)}
          {activeTab === "customers" && <Customers customers={customers} setCustomers={setCustomers} sales={sales} showToast={showToast} isAdmin={isAdmin} highlightPhone={highlightPhone} setGlobalInvoiceSale={setGlobalInvoiceSale} setAppTab={setActiveTab} setInventoryNav={setInventoryNav} />}
          {activeTab === "productsearch" && <ProductSearch products={products} sales={sales} purchases={purchases} isAdmin={isAdmin} setActiveTab={setActiveTab} setInventoryNav={setInventoryNav} />}
          {activeTab === "reports" && (isAdmin ? <Reports sales={sales} products={products} purchases={purchases} customers={customers} setGlobalInvoiceSale={setGlobalInvoiceSale} /> : <StaffBlocked />)}
          {activeTab === "margin" && (isAdmin ? <MarginAnalysis sales={sales} products={products} setGlobalInvoiceSale={setGlobalInvoiceSale} /> : <StaffBlocked />)}
          {activeTab === "broadcast" && (isAdmin ? <WhatsAppBroadcast customers={customers} sales={sales} shopName={shopName} showToast={showToast} /> : <StaffBlocked />)}
          {activeTab === "settings" && (isAdmin ? <Settings shopName={shopName} setShopName={setShopName} showToast={showToast} sales={sales} products={products} purchases={purchases} customers={customers} billCounter={billCounter} setSales={setSales} setProducts={setProducts} setPurchases={setPurchases} setCustomers={setCustomers} setBillCounter={setBillCounter} customSizes={customSizes} setCustomSizes={setCustomSizes} /> : <StaffBlocked />)}

          {/* ── GLOBAL INVOICE DRAWER ── */}
          {globalInvoiceSale && (
            <GlobalInvoiceDrawer
              sale={globalInvoiceSale}
              onClose={() => setGlobalInvoiceSale(null)}
              products={products}
              isAdmin={isAdmin}
              shopName={shopName}
              setActiveTab={setActiveTab}
              setGlobalInvoiceSale={setGlobalInvoiceSale}
              setHighlightPhone={setHighlightPhone}
              setInventoryNav={setInventoryNav}
              setSales={setSales}
              setProducts={setProducts}
              setCustomers={setCustomers}
            />
          )}
        </div>

        {/* ── MOBILE BOTTOM NAV ── */}
        <div className="mobile-bottom-nav">
          {(() => {
            // Show most important tabs on bottom nav — 5 slots
            const mobileNav = [
              { id:"billing",     icon:"🧾", label:"Billing"  },
              { id:"billhistory", icon:"📋", label:"History"  },
              { id:"inventory",   icon:"📦", label:"Stock"    },
              { id:"customers",   icon:"👥", label:"Customers"},
              { id:"dashboard",   icon:"📊", label:"More",    isMore: true },
            ];
            return mobileNav.map(item => {
              const isActive = activeTab === item.id || (item.isMore && !mobileNav.slice(0,4).find(m=>m.id===activeTab));
              const locked = navItems.find(n=>n.id===item.id)?.adminOnly && !isAdmin;
              return (
                <button key={item.id}
                  className={`mob-nav-item ${isActive ? "active" : ""}`}
                  onClick={() => { if(locked){showToast("Sirf Admin 🔒","error");return;} setActiveTab(item.id); }}
                  style={{ opacity: locked ? 0.4 : 1 }}
                >
                  <span className="mob-icon" style={{ position:"relative" }}>
                    {item.icon}
                    {item.id==="inventory" && lowStockProducts.length>0 && (
                      <span style={{ position:"absolute", top:-2, right:-4, width:8, height:8, background:"#f5576c", borderRadius:"50%", display:"block" }} />
                    )}
                  </span>
                  <span className="mob-label" style={{ color: isActive?"#7c3aed":"#9ca3af", fontWeight: isActive?700:500 }}>{item.label}</span>
                  {isActive && <span style={{ position:"absolute", top:0, left:"50%", transform:"translateX(-50%)", width:20, height:2.5, background:"linear-gradient(90deg,#7c3aed,#a855f7)", borderRadius:2 }} />}
                </button>
              );
            });
          })()}
        </div>

      </div>
    </div>
  );
}

// ============================================================
// BILL HISTORY
// ============================================================
// Helper: get current version data from a sale (handles both old & new format)
const getCurrentVersion = (sale) => {
  if (!sale) return { versionNo: 1, type: "original", items: [], subtotal: 0, itemDiscountTotal: 0, billDiscount: 0, discount: 0, tax: 0, total: 0, received: 0, date: "", note: "" };
  if (sale.versions && sale.versions.length > 0) {
    return sale.versions[sale.currentVersion ?? sale.versions.length - 1] || sale.versions[0];
  }
  // Old format — wrap it
  return { versionNo: 1, type: "original", items: sale.items || [], subtotal: sale.subtotal || 0, itemDiscountTotal: sale.itemDiscountTotal||0, billDiscount: sale.billDiscount||0, discount: sale.discount||0, tax: sale.tax||0, total: sale.total || 0, received: sale.received||sale.total||0, date: sale.date||"", note: "Original bill" };
};

// Helper: push new version into sale and update top-level mirrors
const pushVersion = (sale, newV) => {
  const versions = [...(sale.versions || [getCurrentVersion(sale)])];
  versions.push(newV);
  return { ...sale, versions, currentVersion: versions.length - 1, ...newV };
};

// ── Utility: compute summary numbers from a saved bill/version ──
// Returns: { items, mrpSubtotal, rateSubtotal, mrpDiscount, itemDiscTotal,
//            billDiscAmt, legacyDisc, totalDiscount, taxAmt, total, received, totalSavings }
const calcBillSummary = (billOrVersion) => {
  if (!billOrVersion) return { items: [], mrpSubtotal: 0, rateSubtotal: 0, mrpDiscount: 0, itemDiscTotal: 0, billDiscAmt: 0, legacyDisc: 0, settledTotal: 0, totalDiscount: 0, taxAmt: 0, total: 0, received: 0, totalSavings: 0 };
  const items = (billOrVersion.items || []).filter(Boolean);
  // MRP subtotal = mrpPerPiece*qty if set, else price*qty
  const mrpSubtotal = billOrVersion.subtotal ||
    items.reduce((a, it) => a + ((it.mrpPerPiece > 0 ? it.mrpPerPiece : it.price) * (it.qty || 1)), 0);
  // Rate subtotal = price*qty (our selling rate)
  const rateSubtotal = billOrVersion.rateSubtotal ||
    items.reduce((a, it) => a + it.price * (it.qty || 1), 0);
  // MRP discount = difference between MRP and rate
  const mrpDiscount = items.reduce((a, it) =>
    a + (it.mrpPerPiece > it.price ? (it.mrpPerPiece - it.price) * (it.qty || 1) : 0), 0);
  // Item-level discounts
  const itemDiscTotal = billOrVersion.itemDiscountTotal ||
    items.reduce((a, it) => a + (it.itemDiscountRs || 0), 0);
  // Bill-level discount
  const billDiscAmt = billOrVersion.billDiscount || 0;
  // Settlement (customer paid less) — track separately, NOT part of "savings/discount"
  const settledTotal = items.reduce((a, it) => a + (it.settledDisc || 0), 0);
  // BUG15 FIX: legacyDisc logic tight karo — new bills pe accidentally trigger nahi hona chahiye
  // Old bills: itemDiscountTotal field exist hi nahi karta (undefined), billDiscount bhi nahi
  // New bills: itemDiscountTotal = 0 possible hai (e.g. sirf bill discount tha) — isliye
  //   'undefined' check karo, '0' nahi — 0 bhi valid new-bill value hai
  // Condition: discount field hai + itemDiscountTotal kabhi set hi nahi hua (legacy bill) + billDiscount nahi
  const legacyDisc = (
    billOrVersion.discount > 0 &&
    billOrVersion.itemDiscountTotal === undefined &&
    !billOrVersion.billDiscount
  ) ? Math.max(0, billOrVersion.discount - settledTotal) : 0;
  const taxAmt = billOrVersion.tax || 0;
  const total = billOrVersion.total || 0;
  const received = billOrVersion.received ?? total;
  // totalSavings = mrp discount + item discount + bill discount + settled (customer ne kam diya = uski bachat)
  const totalSavings = mrpDiscount + itemDiscTotal + billDiscAmt + legacyDisc + settledTotal;
  const totalDiscount = itemDiscTotal + billDiscAmt + legacyDisc;
  return { items, mrpSubtotal, rateSubtotal, mrpDiscount, itemDiscTotal,
           billDiscAmt, legacyDisc, settledTotal, totalDiscount, taxAmt,
           total, received, totalSavings };
};

// ============================================================
// BILL HISTORY
// ============================================================
const BillHistory = ({ sales, setSales, products, setProducts, customers, setCustomers, billCounter, setBillCounter, shopName, isAdmin, setActiveTab, setHighlightPhone, setGlobalInvoiceSale }) => {
  const today = getISTDateStr(); // BUG25 FIX: IST
  const yesterday = getISTDaysAgo(1); // BUG25 FIX: IST

  const [filter, setFilter] = useState("today");
  const [customDate, setCustomDate] = useState(today);
  const [customDateTo, setCustomDateTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [regionFilter, setRegionFilter] = useState("all");
  const [billTypeFilter, setBillTypeFilter] = useState("all"); // all|original|replace|return
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");

  // ── Filter + sort logic ──
  const getFiltered = () => {
    let base = [...sales];
    const getFullDate = s => (getCurrentVersion(s).date || s.date) || "";
    // IST-aware date extraction: store kaafi sahi hai, sirf compare ke liye IST slice
    const getDate = s => {
      const raw = getFullDate(s);
      if (!raw) return "";
      // If timestamp has T (ISO), convert to IST date string
      if (raw.length > 10) {
        const d = new Date(raw);
        if (!isNaN(d)) {
          // IST = UTC + 5:30
          const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
          return ist.toISOString().split("T")[0];
        }
      }
      return raw.slice(0, 10);
    };
    const getTotal = s => getCurrentVersion(s).total || 0;
    const getType = s => getCurrentVersion(s).type || "original";

    if (filter === "today")     base = base.filter(s => getDate(s) === today);
    if (filter === "yesterday") base = base.filter(s => getDate(s) === yesterday);
    if (filter === "week")      { const d = getISTDaysAgo(7); base = base.filter(s => getDate(s) >= d); }
    if (filter === "month")     { const d = getISTDaysAgo(30); base = base.filter(s => getDate(s) >= d); }
    if (filter === "custom")    base = base.filter(s => getDate(s) >= customDate && getDate(s) <= (customDateTo||customDate));

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      base = base.filter(s => s.billNo?.toLowerCase().includes(q) || s.customer?.toLowerCase().includes(q) || s.phone?.includes(q) || getCurrentVersion(s).items?.some(i => i.name?.toLowerCase().includes(q) || i.size?.toLowerCase().includes(q) || i.color?.toLowerCase().includes(q) || (i.sku||'').toLowerCase().includes(q)));
    }
    if (regionFilter !== "all") base = base.filter(s => (s.region||"") === regionFilter);
    if (billTypeFilter !== "all") base = base.filter(s => getType(s) === billTypeFilter);
    if (minAmt) base = base.filter(s => getTotal(s) >= +minAmt);
    if (maxAmt) base = base.filter(s => getTotal(s) <= +maxAmt);

    base.sort((a, b) => {
      if (sortBy === "date_desc")   return getFullDate(b).localeCompare(getFullDate(a));
      if (sortBy === "date_asc")    return getFullDate(a).localeCompare(getFullDate(b));
      if (sortBy === "bill_desc")   return parseInt((b.billNo||"0").replace(/\D/g,""),10) - parseInt((a.billNo||"0").replace(/\D/g,""),10);
      if (sortBy === "bill_asc")    return parseInt((a.billNo||"0").replace(/\D/g,""),10) - parseInt((b.billNo||"0").replace(/\D/g,""),10);
      if (sortBy === "amount_desc") return getTotal(b) - getTotal(a);
      if (sortBy === "amount_asc")  return getTotal(a) - getTotal(b);
      if (sortBy === "customer")    return (a.customer||"").localeCompare(b.customer||"");
      return getFullDate(b).localeCompare(getFullDate(a));
    });
    return base;
  };

  const filtered = getFiltered();

  // Group by IST date
  const grouped = filtered.reduce((acc, s) => {
    const raw = (getCurrentVersion(s).date || s.date || "");
    let d = "Unknown";
    if (raw) {
      if (raw.length > 10) {
        const dt = new Date(raw);
        if (!isNaN(dt)) {
          const ist = new Date(dt.getTime() + 5.5 * 60 * 60 * 1000);
          d = ist.toISOString().split("T")[0];
        } else { d = raw.slice(0, 10); }
      } else { d = raw.slice(0, 10); }
    }
    if (!acc[d]) acc[d] = [];
    acc[d].push(s);
    return acc;
  }, {});

  const dateLabel = d => {
    if (d===today) return "📅 Aaj — "+new Date(d+"T00:00:00+05:30").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"});
    if (d===yesterday) return "📅 Kal — "+new Date(d+"T00:00:00+05:30").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"});
    return "📅 "+new Date(d+"T00:00:00+05:30").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  };

  const totalAmt = filtered.reduce((a, s) => a + getCurrentVersion(s).total, 0);
  const totalDisc = filtered.reduce((a, s) => { const v = getCurrentVersion(s); return a + (v.discount||0); }, 0);

  return (
    <div className="page">
      <div style={{ marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800, color:"#111827", marginBottom:4 }}>🧾 Bill History</h2>
        <p style={{ fontSize:13, color:"#9ca3af" }}>Saare bills • Date wise • Replace / Return / Undo</p>
      </div>

      {/* ── Advanced Filter Bar ── */}
      <div className="card" style={{ marginBottom:14, padding:"12px 16px" }}>
        {/* Row 1: Date chips + search */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
          <div style={{ display:"flex", gap:3, background:"#f3f4f6", borderRadius:12, padding:3, flexShrink:0 }}>
            {[{id:"today",label:"Aaj"},{id:"yesterday",label:"Kal"},{id:"week",label:"7 Din"},{id:"month",label:"30 Din"},{id:"all",label:"Sab"},{id:"custom",label:"📅 Range"}].map(b => (
              <button key={b.id} onClick={()=>setFilter(b.id)}
                style={{ padding:"5px 11px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                  background: filter===b.id ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "transparent",
                  color: filter===b.id ? "white" : "#6b7280" }}>
                {b.label}
              </button>
            ))}
          </div>
          {filter==="custom" && (
            <>
              <input type="date" className="input" value={customDate} onChange={e=>setCustomDate(e.target.value)} max={today} style={{ width:140, fontSize:12, padding:"5px 8px", color:"#7c3aed", fontWeight:600 }} />
              <span style={{ fontSize:12, color:"#9ca3af" }}>—</span>
              <input type="date" className="input" value={customDateTo} onChange={e=>setCustomDateTo(e.target.value)} max={today} style={{ width:140, fontSize:12, padding:"5px 8px", color:"#7c3aed", fontWeight:600 }} />
            </>
          )}
          <div style={{ position:"relative", marginLeft:"auto" }}>
            <svg style={{ position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#9ca3af" }} width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="input" style={{ paddingLeft:28, width:200, fontSize:12 }} placeholder="Bill, customer, item, size..."  /* BUG50 FIX */ value={searchText} onChange={e=>setSearchText(e.target.value)} />
          </div>
        </div>
        {/* Row 2: Region + Type + Amount + Sort */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          {/* Region */}
          <div style={{ display:"flex", gap:3, alignItems:"center" }}>
            <span style={{ fontSize:10.5, fontWeight:700, color:"#9ca3af" }}>Region:</span>
            {[["all","All"],["local","🏠"],["out-city","🌆"],["out-state","✈️"]].map(([v,l])=>(
              <button key={v} onClick={()=>setRegionFilter(v)} style={{ padding:"3px 10px", fontSize:11, fontWeight:600, borderRadius:16, border:`1.5px solid ${regionFilter===v?"#7c3aed":"#e5e7eb"}`, background:regionFilter===v?"#f5f3ff":"white", color:regionFilter===v?"#7c3aed":"#6b7280", cursor:"pointer" }}>{l}</button>
            ))}
          </div>
          {/* Bill type */}
          <div style={{ display:"flex", gap:3, alignItems:"center" }}>
            <span style={{ fontSize:10.5, fontWeight:700, color:"#9ca3af" }}>Type:</span>
            {[["all","All"],["original","✅ Original"],["replace","🔄 Replace"],["return","↩️ Return"]].map(([v,l])=>(
              <button key={v} onClick={()=>setBillTypeFilter(v)} style={{ padding:"3px 10px", fontSize:11, fontWeight:600, borderRadius:16, border:`1.5px solid ${billTypeFilter===v?"#7c3aed":"#e5e7eb"}`, background:billTypeFilter===v?"#f5f3ff":"white", color:billTypeFilter===v?"#7c3aed":"#6b7280", cursor:"pointer", whiteSpace:"nowrap" }}>{l}</button>
            ))}
          </div>
          {/* Amount range */}
          <input type="number" onWheel={e=>e.target.blur()} className="input" value={minAmt} onChange={e=>setMinAmt(e.target.value)} placeholder="Min ₹" style={{ width:78, padding:"4px 8px", fontSize:12 }} />
          <span style={{ fontSize:12, color:"#9ca3af" }}>—</span>
          <input type="number" onWheel={e=>e.target.blur()} className="input" value={maxAmt} onChange={e=>setMaxAmt(e.target.value)} placeholder="Max ₹" style={{ width:78, padding:"4px 8px", fontSize:12 }} />
          {/* Sort */}
          <select className="select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ padding:"4px 8px", fontSize:12, width:"auto", marginLeft:4 }}>
            <option value="date_desc">📅 Date ↓ (Latest)</option>
            <option value="date_asc">📅 Date ↑ (Oldest)</option>
            <option value="bill_desc">🔢 Bill# ↓</option>
            <option value="bill_asc">🔢 Bill# ↑</option>
            <option value="amount_desc">💰 Amount ↓</option>
            <option value="amount_asc">💰 Amount ↑</option>
            <option value="customer">👤 Customer A-Z</option>
          </select>
          {/* Clear btn */}
          {(searchText||regionFilter!=="all"||billTypeFilter!=="all"||minAmt||maxAmt) && (
            <button onClick={()=>{setSearchText("");setRegionFilter("all");setBillTypeFilter("all");setMinAmt("");setMaxAmt("");}} style={{ padding:"4px 10px", fontSize:11, color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:8, background:"white", cursor:"pointer", fontWeight:700 }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {filtered.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
          {[{label:"Bills",value:filtered.length,color:"#7c3aed",bg:"#f5f3ff"},{label:"Total Amount",value:`₹${totalAmt.toLocaleString()}`,color:"#059669",bg:"#ecfdf5"},{label:"Total Discount",value:`₹${totalDisc.toLocaleString()}`,color:"#dc2626",bg:"#fef2f2"}].map(s=>(
            <div key={s.label} className="card" style={{ background:s.bg, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:11.5, color:"#9ca3af", fontWeight:600 }}>{s.label}</span>
              <span style={{ fontSize:17, fontWeight:800, color:s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bill list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>🧾</div>
          <p style={{ fontSize:15, fontWeight:600 }}>Koi bill nahi mila</p>
        </div>
      ) : Object.keys(grouped).sort((a,b)=>b.localeCompare(a)).map(date => (
        <div key={date} style={{ marginBottom:22 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:"#6b7280", background:"#f3f4f6", padding:"4px 12px", borderRadius:18 }}>{dateLabel(date)}</div>
            <div style={{ flex:1, height:1, background:"#f3f4f6" }} />
            <span style={{ fontSize:11.5, color:"#9ca3af", fontWeight:600 }}>{grouped[date].length} bills • ₹{grouped[date].reduce((a,s)=>a+getCurrentVersion(s).total,0).toLocaleString()}</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[...grouped[date]].sort((a,b) => (getCurrentVersion(b).date||b.date||"").localeCompare(getCurrentVersion(a).date||a.date||"")||b.id-a.id).map(sale => {
              const v = getCurrentVersion(sale);
              const hasVersions = (sale.versions?.length||1) > 1;
              const borderColor = v.type==="return"?"#fecaca":v.type==="replace"?"#fde68a":"#f3f4f6";
              return (
                <div key={sale.id} onClick={()=>setGlobalInvoiceSale(sale)}
                  style={{ background:"white", border:`1.5px solid ${borderColor}`, borderRadius:14, padding:"12px 16px", cursor:"pointer", transition:"all 0.15s", display:"flex", alignItems:"center", gap:14 }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#a855f7";e.currentTarget.style.boxShadow="0 4px 16px rgba(124,58,237,0.08)";e.currentTarget.style.transform="translateY(-1px)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=borderColor;e.currentTarget.style.boxShadow="none";e.currentTarget.style.transform="none";}}>
                  {/* Bill No */}
                  <div style={{ background:"#f5f3ff", borderRadius:10, padding:"7px 10px", textAlign:"center", flexShrink:0 }}>
                    <div style={{ fontSize:9.5, color:"#9ca3af", fontWeight:600 }}>BILL</div>
                    <div style={{ fontSize:12.5, fontWeight:800, color:"#7c3aed" }}>{sale.billNo?.replace("INV-","#")}</div>
                    {hasVersions && <div style={{ fontSize:9, color:"#a855f7", fontWeight:700 }}>v{(sale.currentVersion??0)+1}</div>}
                  </div>
                  {/* Info */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, fontSize:13.5, color:"#111827" }}>{sale.customer||"Walk-in"}</span>
                      {sale.phone && <span style={{ fontSize:11, color:"#9ca3af" }}>📞 {sale.phone}</span>}
                      {v.type==="return" && <span style={{ fontSize:10, background:"#fef2f2", color:"#dc2626", padding:"1px 7px", borderRadius:8, fontWeight:700 }}>↩ Return</span>}
                      {v.type==="replace" && <span style={{ fontSize:10, background:"#fff7ed", color:"#d97706", padding:"1px 7px", borderRadius:8, fontWeight:700 }}>🔄 Replace</span>}
                    </div>
                    <div style={{ fontSize:11.5, color:"#6b7280", display:"flex", gap:5, flexWrap:"wrap" }}>
                      {v.items?.slice(0,3).map((it,i)=>(
                        <span key={i} style={{ background:"#f9fafb", padding:"1px 7px", borderRadius:5 }}>{it.name} ×{it.qty}</span>
                      ))}
                      {v.items?.length>3 && <span style={{ background:"#f9fafb", padding:"1px 7px", borderRadius:5, color:"#9ca3af" }}>+{v.items.length-3}</span>}
                    </div>
                  </div>
                  {/* Amount */}
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:16, fontWeight:800, color:"#059669" }}>₹{v.total.toLocaleString()}</div>
                    {(v.discount||0) > 0 && <div style={{ fontSize:10.5, color:"#dc2626", fontWeight:600 }}>−₹{v.discount} off</div>}
                    {(() => { const raw = getCurrentVersion(sale).date||sale.date||""; if (raw.length > 10) { try { const d = new Date(raw); return !isNaN(d) ? <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>{d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div> : null; } catch {} } return null; })()}
                    <div style={{ fontSize:10, color:"#c4b5fd", marginTop:1 }}>tap →</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

    </div>
  );
};



// ============================================================
// DASHBOARD
// ============================================================
const Dashboard = ({ products, sales, totalRevenue, totalProfit, todayRevenue, todaySales, lowStockProducts, setActiveTab, purchases, setGlobalInvoiceSale }) => {
  const [dashPeriod, setDashPeriod] = useState("today"); // today | week | month | all
  const totalStockValue = products.reduce((a, b) => a + b.sellingPrice * b.quantity, 0);
  const totalItems = products.reduce((a, b) => a + b.quantity, 0);

  const getCV2 = (s) => { if (!s) return {}; return (s.versions && s.versions.length > 0) ? (s.versions[s.currentVersion ?? s.versions.length - 1] || s.versions[0] || s) : s; };

  // Period-filtered sales
  const periodSales = (() => {
    const todayStr = getISTDateStr(); // BUG25 FIX: IST
    if (dashPeriod === "today") return sales.filter(s => ((getCV2(s).date||s.date)||'').slice(0,10) === todayStr);
    if (dashPeriod === "week")  { const d = getISTDaysAgo(7); return sales.filter(s => ((getCV2(s).date||s.date)||"").slice(0,10) >= d); } // BUG26 FIX: IST
    if (dashPeriod === "month") { const d = getISTDaysAgo(30); return sales.filter(s => ((getCV2(s).date||s.date)||"").slice(0,10) >= d); } // BUG26 FIX: IST
    return sales;
  })();
  const periodRevenue = periodSales.filter(Boolean).reduce((a, s) => a + (getCV2(s).total||0), 0);
  const periodItems = periodSales.reduce((a, s) => a + (getCV2(s).items||s.items||[]).filter(Boolean).reduce((b, it) => b + (it?.qty||1), 0), 0);
  const periodDiscount = periodSales.filter(Boolean).reduce((a, s) => a + (getCV2(s).discount||0), 0);
  const periodAvg = periodSales.length > 0 ? Math.round(periodRevenue / periodSales.length) : 0;

  // Last 7 days chart
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split("T")[0];
    const dayName = d.toLocaleDateString("en-IN", { weekday: "short" });
    const total = sales.filter(s => (getCV2(s).date||s.date) === dateStr).reduce((a, b) => a + getCV2(b).total, 0);
    const count = sales.filter(s => (getCV2(s).date||s.date) === dateStr).length;
    return { day: dayName, total, count, date: dateStr };
  });
  const maxSale = Math.max(...last7.map(d => d.total), 1);

  // Top products from period
  const productSales = {};
  periodSales.forEach(s => { const v = getCV2(s); (v.items||s.items||[]).forEach(i => { productSales[i.name] = (productSales[i.name] || 0) + i.qty; }); });
  const topProducts = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Category breakdown
  const catRevenue = {};
  periodSales.forEach(s => {
    const v = getCV2(s);
    (v.items||s.items||[]).forEach(it => {
      const p = products.find(x => x.id === it.productId || x.name === it.name);
      const cat = p?.category || "Other";
      catRevenue[cat] = (catRevenue[cat]||0) + (it.effectiveTotal ?? it.price * it.qty);
    });
  });
  const topCats = Object.entries(catRevenue).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxCatRev = topCats[0]?.[1] || 1;

  // Recent sales — sorted by latest version date descending
  const recentSales = [...sales]
    .sort((a,b) => (getCV2(b).date||b.date||"").localeCompare(getCV2(a).date||a.date||"")||b.id-a.id)
    .slice(0, 6);

  const periodLabel = { today:"Aaj", week:"7 Din", month:"30 Din", all:"Sab Time" }[dashPeriod];

  const statCards = [
    { label: `${periodLabel} — Revenue`, value: `₹${periodRevenue.toLocaleString()}`, sub: `${periodSales.length} bills`, icon: "billing", color: "#7c3aed", bg: "#f5f3ff" },
    { label: `${periodLabel} — Items Sold`, value: periodItems, sub: `Avg ₹${periodAvg.toLocaleString()}/bill`, icon: "inventory", color: "#059669", bg: "#ecfdf5" },
    { label: "Total Profit (All Time)", value: `₹${totalProfit.toLocaleString()}`, sub: `Margin: ${totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0}%`, icon: "rupee", color: "#d97706", bg: "#fffbeb" },
    { label: "Stock Value", value: `₹${totalStockValue.toLocaleString()}`, sub: `${totalItems} items • ${products.length} products`, icon: "trend", color: "#2563eb", bg: "#eff6ff" },
  ];

  return (
    <div className="page">
      {/* Period selector */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800, color:"#111827" }}>📊 Dashboard</h2>
        <div style={{ display:"flex", gap:3, background:"#f3f4f6", borderRadius:12, padding:3 }}>
          {[["today","Aaj"],["week","7 Din"],["month","30 Din"],["all","Sab"]].map(([v,l])=>(
            <button key={v} onClick={()=>setDashPeriod(v)}
              style={{ padding:"5px 14px", borderRadius:9, border:"none", cursor:"pointer", fontSize:12.5, fontWeight:600,
                background: dashPeriod===v ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "transparent",
                color: dashPeriod===v ? "white" : "#6b7280" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        {statCards.map((s, i) => (
          <div key={i} className="stat-card">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{s.label}</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>{s.value}</p>
                <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>{s.sub}</p>
              </div>
              <div style={{ width: 42, height: 42, background: s.bg, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: s.color }}>
                <Icon name={s.icon} size={20} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2col" style={{ marginBottom: 20 }}>
        {/* Sales Chart — last 7 days always */}
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 20 }}>📈 Sales — Last 7 Days</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110 }}>
            {last7.map((d, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>{d.total > 0 ? "₹"+(d.total/1000).toFixed(1)+"k" : ""}</div>
                <div style={{ width: "100%", background: d.total > 0 ? "linear-gradient(to top,#7c3aed,#a855f7)" : "#f3f4f6", borderRadius: "5px 5px 0 0", height: `${Math.max((d.total/maxSale)*100, d.total>0?8:4)}px`, transition:"height 0.5s ease", minHeight:4, position:"relative" }}
                  title={`₹${d.total.toLocaleString()} • ${d.count} bills`} />
                <div style={{ fontSize: 10.5, color: "#6b7280", fontWeight: 500 }}>{d.day}</div>
                {d.count > 0 && <div style={{ fontSize: 9, color: "#a855f7", fontWeight: 700 }}>{d.count}b</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Category breakdown */}
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 14 }}>🏷️ Category Revenue ({periodLabel})</h3>
          {topCats.length === 0 ? <p style={{ color:"#9ca3af", fontSize:13 }}>No sales data</p> : topCats.map(([cat, rev], i) => {
            const colors = ["#7c3aed","#059669","#d97706","#2563eb","#dc2626"];
            return (
              <div key={cat} style={{ marginBottom:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ fontSize:12.5, fontWeight:600, color:"#374151" }}>{cat}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:colors[i%5] }}>₹{rev.toLocaleString()}</span>
                </div>
                <div style={{ background:"#f3f4f6", borderRadius:6, height:7, overflow:"hidden" }}>
                  <div style={{ width:`${(rev/maxCatRev)*100}%`, height:"100%", background:colors[i%5], borderRadius:6, transition:"width 0.8s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid-2col">
        {/* Top Products */}
        <div className="card">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>🔥 Top Products ({periodLabel})</h3>
            <button className="btn btn-outline btn-sm" onClick={() => setActiveTab("inventory")}>Inventory</button>
          </div>
          {topProducts.length === 0 ? <p style={{ color: "#9ca3af", fontSize: 13 }}>No sales data yet</p> : topProducts.map(([name, qty], i) => {
            const maxQ = topProducts[0][1];
            const colors = ["#7c3aed", "#059669", "#d97706", "#2563eb", "#dc2626"];
            return (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors[i%5], flexShrink:0, marginLeft:8 }}>{qty} pcs</span>
                </div>
                <div style={{ background: "#f3f4f6", borderRadius: 6, height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${(qty / maxQ) * 100}%`, height: "100%", background: colors[i%5], borderRadius: 6, transition: "width 0.8s ease" }} />
                </div>
              </div>
            );
          })}
          {periodDiscount > 0 && <div style={{ marginTop:12, padding:"8px 10px", background:"#fef3c7", borderRadius:8, fontSize:11.5, color:"#92400e", fontWeight:600 }}>🏷️ Total Discounts Given: ₹{periodDiscount.toLocaleString()}</div>}
        </div>

        {/* Low Stock + Recent Sales */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* Low Stock */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>⚠️ Low Stock ({lowStockProducts.length})</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setActiveTab("inventory")}>View All</button>
            </div>
            {lowStockProducts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "10px", color: "#059669" }}>
                <p style={{ fontSize: 13 }}>✅ All stock healthy!</p>
              </div>
            ) : lowStockProducts.slice(0,4).map(p => {
              // BUG49 FIX: size-variant pe kaunse sizes low hain dikhao
              const lowSizes = p.pricingType === "size-variant" && p.sizeVariants?.length
                ? p.sizeVariants.filter(sv => (sv.stock || 0) <= 5)
                : null;
              return (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f9fafb" }}>
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: "#1f2937" }}>{p.name}</p>
                  <p style={{ fontSize: 11, color: "#9ca3af" }}>{p.category}</p>
                  {lowSizes && lowSizes.length > 0 && (
                    <p style={{ fontSize: 10, color: "#e11d48", fontWeight: 700, marginTop: 2 }}>
                      Low sizes: {lowSizes.map(sv => `${sv.size}(${sv.stock||0})`).join(", ")}
                    </p>
                  )}
                </div>
                <span className="low-stock-badge">{lowSizes ? `${lowSizes.length} size(s)` : `${p.quantity} left`}</span>
              </div>
              );
            })}
          </div>

          {/* Recent Sales */}
          <div className="card" style={{ flex:1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>🧾 Recent Bills</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setActiveTab("billhistory")}>History</button>
            </div>
            {recentSales.map(s => {
              const v = getCV2(s);
              return (
              <div key={s.id}
                onClick={() => setGlobalInvoiceSale && setGlobalInvoiceSale(s)}
                style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 8px", borderRadius:8, cursor:"pointer", transition:"background 0.15s", marginBottom:2 }}
                onMouseEnter={e=>e.currentTarget.style.background="#f5f3ff"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <div>
                  <p style={{ fontSize:12.5, fontWeight:600, color:"#1f2937" }}>{s.customer||"Walk-in"}</p>
                  <p style={{ fontSize:11, color:"#9ca3af" }}>{s.billNo} · {fmtDateFriendly(v.date||s.date)}</p>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#059669" }}>₹{v.total.toLocaleString()}</span>
                  <span style={{ color:"#c4b5fd", fontSize:14 }}>›</span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// BILL HELPERS — PDF generation + WhatsApp Share
// ============================================================

// Load jsPDF dynamically
const loadJsPDF = () => new Promise((resolve, reject) => {
  if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  script.onload = () => resolve(window.jspdf.jsPDF);
  script.onerror = reject;
  document.head.appendChild(script);
});

// Date helpers — used in PDF + WhatsApp text
const parseBillDate = (d) => { if (!d) return new Date(); const dt = new Date(d); return isNaN(dt) ? new Date() : dt; };
const fmtBillDate = (d) => parseBillDate(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
const fmtBillTime = (d) => parseBillDate(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
// Global friendly date formatter — ISO string ko "9 Mar 2026" format mein
const fmtDateFriendly = (raw) => {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    if (isNaN(d)) return raw;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return raw; }
};

// Generate PDF blob using jsPDF — returns { blob, filename }
const generatePDFBlob = async (bill, shopName) => {
  const JsPDF = await loadJsPDF();

  let SHOP_NAME = "JB Fashion";
  let SHOP_ADDR1 = "Shop No:1, Bhagwant Complex, Pande Chowk";
  let SHOP_ADDR2 = "Barshi - 413401";
  let SHOP_PHONE = "9923970806";
  try {
    SHOP_NAME  = localStorage.getItem('shopName')    || "JB Fashion";
    const addr = localStorage.getItem('shopAddress') || "Shop No:1, Bhagwant Complex, Pande Chowk, Barshi";
    const parts = addr.split(',');
    SHOP_ADDR1 = parts.slice(0, -1).join(',').trim() || addr;
    SHOP_ADDR2 = parts[parts.length - 1].trim() || "Barshi - 413401";
    SHOP_PHONE = localStorage.getItem('shopPhone') || "9923970806";
  } catch(e) {}

  const fmt  = (n) => `Rs.${Number(n).toLocaleString("en-IN")}`;
  const fmtN = (n) => Number(n).toLocaleString("en-IN");

  const items = bill.items || [];
  const itemData = items.map(item => {
    const mrpPc    = item.mrpPerPiece || 0;
    const qty      = item.qty || 1;
    const ratePc   = item.price || 0;
    const rateTotal = ratePc * qty; // eslint-disable-line no-unused-vars
    const mrpTotal  = mrpPc > 0 ? mrpPc * qty : rateTotal;
    const mrpSaveAmt = mrpPc > ratePc ? (mrpPc - ratePc) * qty : 0;
    const iDiscRs   = item.itemDiscountRs || 0;
    const settled   = item.settledDisc || 0;
    const effTotal  = item.effectiveTotal !== undefined
      ? item.effectiveTotal
      : Math.max(0, rateTotal - iDiscRs - settled);
    return { item, mrpPc, qty, ratePc, rateTotal, mrpTotal, mrpSaveAmt, iDiscRs, settled, effTotal };
  });

  const totalPcs      = itemData.reduce((a, d) => a + d.qty, 0);
  const pdfMRPTotal   = itemData.reduce((a, d) => a + d.mrpTotal, 0);
  const mrpSavings    = itemData.reduce((a, d) => a + d.mrpSaveAmt, 0);
  const settledInPdf  = itemData.reduce((a, d) => a + d.settled, 0);
  // BUG6 FIX: itemDiscTotal mein settled double count ho raha tha — hatao
  // settledDisc ek alag shortfall hai, actual discount nahi
  const itemDiscTotal = itemData.reduce((a, d) => a + d.iDiscRs, 0);
  const billDiscAmt   = bill.billDiscount || 0;
  const legacyDisc    = (!bill.itemDiscountTotal && !bill.billDiscount && bill.discount) ? Math.max(0, bill.discount - settledInPdf) : 0;
  // totalSavings = mrpSavings + itemDisc + billDisc + settled (customer ne kam diya = uski bachat)
  const totalSavings  = mrpSavings + itemDiscTotal + billDiscAmt + legacyDisc + settledInPdf;
  const totalPayable  = bill.total || 0;
  // BUG6 FIX: received sahi dikhao — bill.received use karo, fallback totalPayable
  const received      = bill.received ?? totalPayable;
  const balance       = totalPayable - received;

  // 3 inch thermal = 80mm, 4 inch = 101mm — using 80mm width standard
  const W = 80;

  // Estimate height
  let estH = 55; // header
  estH += itemData.length * 22 + 10;
  estH += 50; // summary
  if (totalSavings > 0) estH += 14;
  estH += 20; // footer
  const pageH = Math.max(120, estH);

  const doc = new JsPDF({ unit: "mm", format: [W, pageH], orientation: "portrait" });
  let y = 0;

  const bold = () => doc.setFont("helvetica", "bold");
  const reg  = () => doc.setFont("helvetica", "normal");
  const sz   = (s) => doc.setFontSize(s);
  const black = () => doc.setTextColor(0, 0, 0);
  const gray  = () => doc.setTextColor(80, 80, 80);
  const lgray = () => doc.setTextColor(130, 130, 130);
  const line  = (x1, y1, x2, y2, dashed) => {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    if (dashed) { doc.setLineDash([1.5, 1.5]); doc.line(x1, y1, x2, y2); doc.setLineDash([]); }
    else doc.line(x1, y1, x2, y2);
  };
  const center = (txt, cy, fsz, isBold) => {
    sz(fsz); if (isBold) bold(); else reg();
    doc.text(String(txt), W / 2, cy, { align: "center" });
  };
  const right = (txt, cy, fsz, isBold) => {
    sz(fsz); if (isBold) bold(); else reg();
    doc.text(String(txt), W - 4, cy, { align: "right" });
  };
  const left = (txt, cy, fsz, isBold) => {
    sz(fsz); if (isBold) bold(); else reg();
    doc.text(String(txt), 4, cy);
  };
  // eslint-disable-next-line no-unused-vars
  const row2 = (lbl, val, cy, boldVal) => {
    gray(); left(lbl, cy, 7.5, false);
    black(); right(val, cy, 7.5, boldVal);
  };

  // ── HEADER ──
  y += 6;
  black(); center(SHOP_NAME, y, 13, true);
  y += 5;
  gray(); center(SHOP_ADDR1, y, 6.5, false);
  y += 4;
  gray(); center(SHOP_ADDR2, y, 6.5, false);
  y += 4;
  if (SHOP_PHONE) { gray(); center(`Ph: ${SHOP_PHONE}`, y, 6.5, false); y += 4; }
  y += 1;

  line(3, y, W - 3, y);
  y += 4;

  // Bill info
  const dateStr = fmtBillDate(bill.date);
  const timeStr = fmtBillTime(bill.date);
  black(); left(bill.billNo, y, 7.5, true);
  right(`${dateStr}`, y, 7, false);
  y += 4.5;
  lgray(); right(timeStr, y, 6.5, false);
  y += 3;

  if (bill.customer && bill.customer !== "Walk-in") {
    black(); left(bill.customer, y, 7.5, true);
    if (bill.phone) { y += 4; lgray(); left(bill.phone, y, 6.5, false); }
    y += 2;
  }

  y += 2;
  line(3, y, W - 3, y);
  y += 4;

  // ── COLUMN HEADERS ──
  lgray(); sz(6.5); bold();
  doc.text("ITEM", 4, y);
  doc.text("MRP", W * 0.52, y);
  doc.text("RATE", W * 0.68, y);
  doc.text("TOTAL", W - 4, y, { align: "right" });
  y += 2;
  line(3, y, W - 3, y);
  y += 4;

  // ── ITEMS ──
  itemData.forEach((d, idx) => {
    const { item, mrpPc, qty, ratePc, effTotal } = d; // rateTotal accessed as d.rateTotal below
    const nameRaw  = item.name || "";
    const maxW     = W - 8;
    const nameFull = qty > 1 ? `${nameRaw} x${qty}` : nameRaw;
    // Wrap long names
    const words = nameFull.split(" ");
    let line1 = "", line2 = "";
    sz(8); bold();
    for (const w of words) {
      if (doc.getTextWidth(line1 + w + " ") < maxW * 0.5) line1 += w + " ";
      else line2 += w + " ";
    }
    black(); bold(); sz(8);
    doc.text(line1.trim(), 4, y);
    if (line2.trim()) { y += 4; lgray(); reg(); sz(7); doc.text(line2.trim(), 4, y); }

    // meta (SKU only - no size/color on bill)
    const skuStr = item.sku ? `SKU: ${item.sku}` : "";
    if (skuStr) { y += 3.5; lgray(); reg(); sz(6.5); doc.text(skuStr, 4, y); }


    // prices on same row as name
    const baseY = y - (skuStr ? 3.5 : 0) - (line2.trim() ? 4 : 0);
    // MRP col
    if (mrpPc > 0) { lgray(); reg(); sz(7); doc.text(fmtN(mrpPc * qty), W * 0.52, baseY); }
    else            { lgray(); reg(); sz(7); doc.text("-", W * 0.52, baseY); }
    // Rate col
    gray(); reg(); sz(7); doc.text(fmtN(ratePc), W * 0.68, baseY);
    // Total col
    black(); bold(); sz(8); doc.text(fmtN(effTotal), W - 4, baseY, { align: "right" });

    // item discount lines (MRP disc + item disc + bill disc)
    if (d.mrpSaveAmt > 0) {
      y += 3.5; lgray(); reg(); sz(6.5);
      doc.text(`  MRP Discount: -Rs.${fmtN(d.mrpSaveAmt)}`, 4, y);
    }
    if (d.iDiscRs > 0) {
      y += 3.5; lgray(); reg(); sz(6.5);
      doc.text(`  Item Discount: -Rs.${fmtN(d.iDiscRs)}`, 4, y);
    }
    const billDiscOnItemPdf2 = Math.max(0, Math.round((d.rateTotal - d.iDiscRs - d.settled) - d.effTotal));
    if (billDiscOnItemPdf2 > 0) {
      y += 3.5; lgray(); reg(); sz(6.5);
      doc.text(`  Bill Discount: -Rs.${fmtN(billDiscOnItemPdf2)}`, 4, y);
    }
    if (d.settled > 0) {
      y += 3.5; lgray(); reg(); sz(6.5);
      doc.text(`  Less kiya: -Rs.${fmtN(d.settled)}`, 4, y);
    }

    y += 5;
    if (idx < itemData.length - 1) { line(3, y - 2, W - 3, y - 2, true); }
  });

  line(3, y, W - 3, y);
  y += 5;

  // ── SUMMARY (simple: MRP Total, Discount, TOTAL PAID) ──
  if (pdfMRPTotal > totalPayable) {
    gray(); reg(); sz(7);
    left(`MRP Total (${totalPcs} pcs)`, y, 7, false);
    right(`Rs.${fmtN(pdfMRPTotal)}`, y, 7, false);
    y += 5;
    if (totalSavings > 0) {
      gray(); left("Total Discount", y, 7, false);
      gray(); right(`-Rs.${fmtN(totalSavings)}`, y, 7, false);
      y += 5;
    }
  }

  line(3, y - 1, W - 3, y - 1);
  y += 2;
  // BUG6 FIX: agar partial payment — pehle Bill Total, phir Amount Received dikhao
  if (balance > 0) {
    gray(); reg(); sz(7);
    left("Bill Total", y, 7, false);
    right(`Rs.${fmtN(totalPayable)}`, y, 7, false);
    y += 5;
    black(); left("AMOUNT RECEIVED", y, 9, true);
    black(); right(fmt(received), y, 9, true);
    y += 6;
    line(3, y - 1, W - 3, y - 1);
    y += 2;
    black(); left("Balance Due", y, 8, true);
    black(); right(fmt(balance), y, 8, true);
    y += 6;
  } else {
    black(); left("TOTAL PAID", y, 9, true);
    black(); right(fmt(totalPayable), y, 9, true);
    y += 6;
  }

  // ── SAVINGS — totalSavings ab settled bhi include karta hai ──
  const mrpBasedSavingPDF = totalSavings;
  if (mrpBasedSavingPDF > 0) {
    line(3, y - 1, W - 3, y - 1);
    y += 3;
    black(); center(`** Aapki Bachat: Rs.${fmtN(mrpBasedSavingPDF)} **`, y, 7.5, true);
    y += 5;
  }

  // ── FOOTER ──
  line(3, y, W - 3, y, true);
  y += 5;
  lgray(); center("Shukriya! Dobara padharo.", y, 7, false);
  y += 4;
  black(); center(SHOP_NAME, y, 8, true);

  const filename = `Bill-${bill.billNo}-${(bill.customer || "Customer").replace(/\s+/g,"_")}.pdf`;
  return { blob: doc.output("blob"), filename };
};

// Print: open PDF in new tab with print dialog
const printBillPDF = async (bill, shopName) => {
  try {
    const { blob, filename } = await generatePDFBlob(bill, shopName);
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      // Fallback: direct download
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    }
  } catch(e) { alert("PDF error: " + e.message); }
};

// WhatsApp icon
const WAIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

// BillActions — Print + WhatsApp Share (reusable)
const BillActions = ({ bill, shopName, onClose, showNewBill }) => {
  const [status, setStatus] = useState("idle"); // idle | generating | done | error
  const WA_GREEN = "linear-gradient(135deg,#25d366,#128c7e)";

  const downloadPDF = async () => {
    setStatus("generating");
    try {
      const { blob, filename } = await generatePDFBlob(bill, shopName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus("done");
    } catch(e) {
      setStatus("error");
      alert("PDF error: " + e.message);
    }
  };

  const sharePDF = async () => {
    setStatus("generating");
    try {
      const { blob, filename } = await generatePDFBlob(bill, shopName);
      // Always download first (most reliable)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      // Then try native share if available
      try {
        const file = new File([blob], filename, { type: "application/pdf" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `Bill ${bill.billNo}`, text: `${shopName} — ₹${bill.total}` });
        }
      } catch(shareErr) {
        // Share failed or cancelled - download already done
      }
      setStatus("done");
    } catch(e) {
      setStatus("error"); 
      alert("PDF generate error: " + e.message);
    }
  };

  const whatsappText = () => {
    const date = fmtBillDate(bill.date);
    const time = fmtBillTime(bill.date);
    const sep = "----------------------------";
    let t = `*${shopName}*\n${sep}\n`;
    t += `Bill No: *${bill.billNo}*\nDate: ${date}  |  ${time}\n`;
    if (bill.customer && bill.customer !== "Walk-in") t += `Customer: ${bill.customer}\n`;
    if (bill.phone) t += `Phone: ${bill.phone}\n`;
    t += `${sep}\n`;

    // BUG6 FIX: calcBillSummary se consistent savings nikalo
    const bSummary = calcBillSummary(bill.items ? bill : (bill.versions?.[bill.currentVersion ?? 0] || bill));

    // Per item with proper effective total
    bill.items?.forEach((item, i) => {
      const qty = item.qty || 1;
      const mrpPc = item.mrpPerPiece || 0;
      const ratePc = item.price;
      const rateTotal = ratePc * qty;
      const iDiscRs = item.itemDiscountRs || 0;
      const settled = item.settledDisc || 0;
      const effTotal = item.effectiveTotal !== undefined ? item.effectiveTotal : Math.max(0, rateTotal - iDiscRs - settled);
      const billDiscLine = Math.max(0, Math.round(rateTotal - iDiscRs - settled - effTotal));
      const mrpLineTotal = mrpPc > 0 ? mrpPc * qty : rateTotal;

      t += `\n${i+1}. *${item.name}*`;
      if (item.sku) t += ` [${item.sku}]`;
      t += `\n`;

      if (mrpPc > ratePc) {
        t += `   MRP: Rs.${mrpPc}/pc × ${qty} = Rs.${mrpLineTotal}\n`;
        t += `   MRP Discount: -Rs.${(mrpPc - ratePc) * qty}\n`;
      }
      if (qty > 1) t += `   Rate: Rs.${ratePc} × ${qty} = Rs.${rateTotal}\n`;
      else if (mrpPc <= ratePc) t += `   Rs.${ratePc}\n`;
      if (iDiscRs > 0) t += `   Item Discount: -Rs.${iDiscRs}\n`;
      if (billDiscLine > 0) t += `   Bill Discount: -Rs.${billDiscLine}\n`;
      if (settled > 0) t += `   Less kiya: -Rs.${settled}\n`;
      t += `   *Total: Rs.${effTotal.toLocaleString()}*\n`;
    });

    t += `\n${sep}\n`;

    // BUG6 FIX: totalSaved = calcBillSummary se (mrp + item + bill disc) — consistent with PDF & popup
    // Pehle mrpGrandTotal - bill.total use hota tha — galat tha (settled bhi count hota tha)
    const totalSaved = bSummary.totalSavings; // mrpDiscount + itemDiscTotal + billDiscAmt
    const receivedAmt = bill.received ?? bill.total;

    // totalSavings ab settled bhi include karta hai — sabse sahi number
    const mrpBasedSaving = totalSaved;

    if (bSummary.mrpSubtotal > 0) {
      t += `MRP Total: Rs.${bSummary.mrpSubtotal.toLocaleString()}\n`;
    }
    if (totalSaved > 0) {
      t += `Total Discount: -Rs.${totalSaved.toLocaleString()}\n`;
    }
    t += `*TOTAL PAID: Rs.${receivedAmt.toLocaleString()}*`;
    if (mrpBasedSaving > 0) {
      // Sirf rupees — no percentage (user request)
      t += `\nAapki Bachat: Rs.${mrpBasedSaving.toLocaleString()}`;
    }

    // BUG6 FIX: partial payment — balance bhi dikhao
    if (bill.received !== undefined && bill.received < bill.total) {
      t += `\n⚠️ Balance Baki: Rs.${(bill.total - bill.received).toLocaleString()}`;
    }

    t += `\n\nShukriya! Dobara padharo :)`;

    const phone = bill.phone ? bill.phone.replace(/\D/g,"") : "";
    const num = phone.length === 10 ? `91${phone}` : phone;
    const msg = encodeURIComponent(t);
    window.open(num ? `https://wa.me/${num}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
  };

  const isGenerating = status === "generating";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {/* Main action buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {/* Download PDF */}
        <button
          onClick={downloadPDF}
          disabled={isGenerating}
          style={{ padding: "11px 0", background: "#7c3aed", color: "white", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: isGenerating ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: isGenerating ? 0.7 : 1 }}
        >
          {isGenerating ? "⏳" : "📄"} {isGenerating ? "Ban rahi hai..." : "PDF Download"}
        </button>
        {/* Share PDF */}
        <button
          onClick={sharePDF}
          disabled={isGenerating}
          style={{ padding: "11px 0", background: "linear-gradient(135deg,#7c3aed,#6d28d9)", color: "white", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: isGenerating ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: isGenerating ? 0.7 : 1 }}
        >
          {isGenerating ? "⏳" : "📤"} {isGenerating ? "..." : "PDF Share"}
        </button>
      </div>
      {/* WhatsApp Text */}
      <button
        onClick={whatsappText}
        style={{ padding: "11px 0", background: WA_GREEN, color: "white", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <WAIcon size={18} /> WhatsApp Text Bhejo
      </button>
      {/* Print */}
      <button
        onClick={() => printBillPDF(bill, shopName)}
        style={{ padding: "9px 0", background: "none", border: "1.5px solid #e5e7eb", borderRadius: 10, fontWeight: 600, fontSize: 12.5, cursor: "pointer", color: "#374151", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
      >
        🖨️ Print
      </button>
      {/* Status messages */}
      {status === "done" && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "#15803d", fontWeight: 700, textAlign: "center" }}>
          ✅ PDF download ho gayi! Ab WhatsApp mein attachment bhejo.
        </div>
      )}
      {/* New Bill / Close */}
      {showNewBill && (
        <button onClick={onClose} style={{ padding: "11px 0", background: "#f5f3ff", border: "2px solid #7c3aed", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#7c3aed", marginTop: 2 }}>
          ➕ Naya Bill
        </button>
      )}
    </div>
  );
}

const StaffBlocked = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 16 }}>
    <div style={{ fontSize: 64 }}>🔒</div>
    <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1f2937" }}>Admin Access Only</h2>
    <p style={{ color: "#9ca3af", fontSize: 14, textAlign: "center", maxWidth: 340 }}>Yeh section sirf Admin dekh sakta hai. Staff ke liye yeh section restricted hai — profit, purchase price, aur financial reports sirf admin ko dikhte hain.</p>
  </div>
);

// ============================================================
// INVENTORY
// ============================================================

// Default blank size variant row
const blankVariant = () => ({ size: "", purchasePrice: "", mrp: "", sellingPrice: "", stock: "" });

const Inventory = ({ products, setProducts, showToast, lowStockProducts, isAdmin, generateSKU, customSizes = [], inventoryNav, setInventoryNav }) => {
  const allSizes = [...SIZES, ...customSizes.filter(s => !SIZES.includes(s))];
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [stockFilter, setStockFilter] = useState("all"); // all | ok | low | out
  const [sortBy, setSortBy] = useState("name"); // name | stock_asc | stock_desc | price_asc | price_desc | margin_desc
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editSkuId, setEditSkuId] = useState(null); // inline SKU edit
  const [skuConflict, setSkuConflict] = useState(null); // conflict detection
  const [priceHistoryProduct, setPriceHistoryProduct] = useState(null); // price history modal
  const [editSkuVal, setEditSkuVal] = useState("");
  const [form, setForm] = useState({
    name: "", category: "Shirt", brand: "", colors: "",
    supplier: "", sku: "",
    sizeVariants: [blankVariant()], // NEW: size-wise pricing
    // legacy single-price fields kept for backward compat
    purchasePrice: "", mrp: "", piecesPerPack: "1", sellingPrice: "", quantity: "",
    sizes: [],
  });
  const [useSizeVariants, setUseSizeVariants] = useState(false); // toggle per product

  const filtered = products
    .filter(p =>
      (catFilter === "All" || p.category === catFilter) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()) || (p.brand||"").toLowerCase().includes(search.toLowerCase()) || (p.sku||"").toLowerCase().includes(search.toLowerCase()) || (p.supplier||"").toLowerCase().includes(search.toLowerCase())) &&
      (stockFilter === "all" || (stockFilter === "out" && p.quantity === 0) || (stockFilter === "low" && p.quantity > 0 && p.quantity <= 5) || (stockFilter === "ok" && p.quantity > 5))
    )
    .sort((a, b) => {
      if (sortBy === "name")        return a.name.localeCompare(b.name);
      if (sortBy === "stock_asc")   return a.quantity - b.quantity;
      if (sortBy === "stock_desc")  return b.quantity - a.quantity;
      if (sortBy === "price_asc")   return (a.sellingPrice||0) - (b.sellingPrice||0);
      if (sortBy === "price_desc")  return (b.sellingPrice||0) - (a.sellingPrice||0);
      if (sortBy === "margin_desc") return ((b.sellingPrice-b.purchasePrice)/Math.max(b.sellingPrice,1)) - ((a.sellingPrice-a.purchasePrice)/Math.max(a.sellingPrice,1));
      if (sortBy === "category")    return a.category.localeCompare(b.category);
      return 0;
    });

  const openAdd = () => {
    const autoSKU = generateSKU(products);
    setEditProduct(null);
    setUseSizeVariants(false);
    setForm({ name: "", category: "Shirt", brand: "", colors: "", supplier: "", sku: autoSKU,
      sizeVariants: [blankVariant()],
      purchasePrice: "", mrp: "", piecesPerPack: "1", sellingPrice: "", quantity: "", sizes: [] });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditProduct(p);
    const hasSV = p.sizeVariants && p.sizeVariants.length > 0;
    setUseSizeVariants(hasSV);
    setForm({
      ...p,
      colors: Array.isArray(p.colors) ? p.colors.join(", ") : (p.colors || ""),
      sizeVariants: hasSV ? p.sizeVariants : [blankVariant()],
      sizes: p.sizes || [],
    });
    setShowModal(true);
  };

  // size variant helpers
  const addVariantRow = () => setForm(f => ({ ...f, sizeVariants: [...f.sizeVariants, blankVariant()] }));
  const removeVariantRow = (i) => setForm(f => ({ ...f, sizeVariants: f.sizeVariants.filter((_, j) => j !== i) }));
  const updateVariant = (i, key, val) => setForm(f => ({
    ...f,
    sizeVariants: f.sizeVariants.map((sv, j) => j === i ? { ...sv, [key]: val } : sv)
  }));

  // ── Handle navigation from Invoice (GlobalInvoiceDrawer → product click) ──
  useEffect(() => {
    if (!inventoryNav) return;
    if (inventoryNav.type === "edit" && inventoryNav.productId) {
      const prod = products.find(p => p.id === inventoryNav.productId);
      if (prod) {
        openEdit(prod);
        // Scroll to product in list
        setTimeout(() => {
          const el = document.getElementById(`inv-product-${prod.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    } else if (inventoryNav.type === "add" && inventoryNav.prefill) {
      const pf = inventoryNav.prefill;
      const autoSKU = generateSKU(products);
      setEditProduct(null);
      setUseSizeVariants(pf.sizes?.length > 0 ? false : false); // keep simple mode, user can switch
      setForm({
        name: pf.name || "",
        category: "Shirt",
        brand: "",
        colors: pf.colors || "",
        supplier: "",
        sku: autoSKU,
        sizeVariants: [blankVariant()],
        purchasePrice: "",
        mrp: "",
        piecesPerPack: "1",
        sellingPrice: pf.sellingPrice || "",
        quantity: "",
        sizes: pf.sizes || [],
      });
      setShowModal(true);
    }
    // Clear nav after handling
    setInventoryNav && setInventoryNav(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryNav]);

  const saveProduct = () => {
    if (!form.name) { showToast("Product naam daalo", "error"); return; }
    const colorsArr = typeof form.colors === "string" ? form.colors.split(",").map(c => c.trim()).filter(Boolean) : form.colors;
    let sku = form.sku ? form.sku.toLowerCase().trim() : generateSKU(products);
    if (!editProduct) {
      const existingSKUs = products.map(p => (p.sku || "").toLowerCase());
      if (existingSKUs.includes(sku)) sku = generateSKU(products);
    }

    let productData;
    if (useSizeVariants) {
      const variants = form.sizeVariants.filter(sv => sv.size && sv.sellingPrice);
      if (variants.length === 0) { showToast("Kam se kam ek size variant daalo", "error"); return; }
      const totalStock = variants.reduce((a, sv) => a + (+sv.stock || 0), 0);
      // For backward compat — use first variant's prices as "default"
      productData = {
        ...form, sku, colors: colorsArr,
        sizeVariants: variants.map(sv => ({
          size: sv.size,
          purchasePrice: +sv.purchasePrice || 0,
          mrp: +sv.mrp || 0,
          piecesPerBox: +sv.piecesPerBox || 1,
          mrpPerPiece: sv.mrp > 0 ? Math.round(+sv.mrp / (+sv.piecesPerBox || 1)) : 0,
          sellingPrice: +sv.sellingPrice,
          stock: +sv.stock || 0,
        })),
        sizes: variants.map(sv => sv.size),
        sellingPrice: +variants[0].sellingPrice,
        purchasePrice: +variants[0].purchasePrice || 0,
        mrp: +variants[0].mrp || 0,
        quantity: totalStock,
        pricingType: "size-variant",
      };
    } else {
      if (!form.sellingPrice || !form.quantity) { showToast("Selling price aur quantity daalo", "error"); return; }
      productData = {
        ...form, sku, colors: colorsArr,
        purchasePrice: +form.purchasePrice, mrp: +form.mrp || 0,
        piecesPerPack: +form.piecesPerPack || 1,
        sellingPrice: +form.sellingPrice, quantity: +form.quantity,
        sizeVariants: [],
        pricingType: "simple",
      };
    }

    if (editProduct) {
      setProducts(products.map(p => p.id === editProduct.id ? { ...productData, id: p.id } : p));
      showToast("Product update ho gaya!");
    } else {
      setProducts([...products, { ...productData, id: Date.now() }]);
      showToast("Product add ho gaya!");
    }
    setShowModal(false);
  };

  const deleteProduct = (id) => {
    if (window.confirm("Delete this product?")) {
      setProducts(products.filter(p => p.id !== id));
      deleteFromCol("products", id); // explicitly delete from Firestore
      showToast("Product deleted");
    }
  };
  const toggleSize = (s) => setForm(f => ({ ...f, sizes: f.sizes.includes(s) ? f.sizes.filter(x => x !== s) : [...f.sizes, s] }));

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize:20, fontWeight:800, color:"#111827" }}>📦 Inventory</h2>
        <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Add Product</button>
      </div>

      {/* Advanced Filters */}
      <div className="card" style={{ marginBottom:14, padding:"12px 16px" }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:8 }}>
          {/* Search */}
          <div className="search-bar" style={{ flex:1, minWidth:200 }}>
            <Icon name="search" size={14} />
            <input className="input" style={{ paddingLeft:32, fontSize:12.5 }} placeholder="Name, brand, SKU, supplier..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Category */}
          <select className="select" style={{ width:140, padding:"6px 10px", fontSize:12.5 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="All">All Categories</option>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          {/* Sort */}
          <select className="select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ width:"auto", padding:"6px 10px", fontSize:12.5 }}>
            <option value="name">Name A-Z</option>
            <option value="category">Category</option>
            <option value="stock_asc">Stock ↑ (Low first)</option>
            <option value="stock_desc">Stock ↓ (High first)</option>
            <option value="price_desc">Price ↓ (Highest)</option>
            <option value="price_asc">Price ↑ (Lowest)</option>
            {isAdmin && <option value="margin_desc">Margin% ↓ (Best)</option>}
          </select>
        </div>
        {/* Stock filter chips */}
        <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Stock:</span>
          {[["all","All"],["ok","✅ In Stock"],["low","⚠️ Low (≤5)"],["out","❌ Out of Stock"]].map(([v,l])=>(
            <button key={v} onClick={()=>setStockFilter(v)} style={{ padding:"3px 12px", fontSize:11.5, fontWeight:600, borderRadius:16, border:`1.5px solid ${stockFilter===v?"#7c3aed":"#e5e7eb"}`, background:stockFilter===v?"#f5f3ff":"white", color:stockFilter===v?"#7c3aed":"#6b7280", cursor:"pointer" }}>{l}</button>
          ))}
          <span style={{ fontSize:11, color:"#9ca3af", marginLeft:"auto" }}>{filtered.length} products</span>
        </div>
      </div>

      {lowStockProducts.length > 0 && (
        <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="alert" size={18} />
          <span style={{ fontSize: 13.5, color: "#e11d48", fontWeight: 600 }}>{lowStockProducts.length} product(s) running low on stock: {lowStockProducts.map(p => p.name).join(", ")}</span>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-scroll-wrap" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table className="table">
            <thead><tr>
              <th>Name / SKU</th><th>Category</th><th>Brand</th><th>Sizes</th>
              {isAdmin && <th>Purchase</th>}<th>MRP / Pack</th>
              <th>Rate/Piece</th>{isAdmin && <th>Margin</th>}<th>Stock</th><th>Supplier</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const isSV = p.pricingType === "size-variant" && p.sizeVariants?.length > 0;
                const ppp = p.piecesPerPack || 1;
                const mrpPerPiece = p.mrp > 0 ? Math.round(p.mrp / ppp) : 0;
                const margin = p.purchasePrice > 0 ? Math.round(((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100) : 0;
                return (
                  <tr key={p.id} id={`inv-product-${p.id}`}>
                    <td>
                      <div style={{ fontWeight: 600, color: "#111827" }}>{p.name}</div>
                      {editSkuId === p.id ? (
                        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                          <input
                            autoFocus
                            value={editSkuVal}
                            onChange={e => setEditSkuVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const newSku = editSkuVal.trim();
                                setProducts(products.map(pr => pr.id === p.id ? { ...pr, sku: newSku } : pr));
                                setEditSkuId(null);
                              }
                              if (e.key === "Escape") setEditSkuId(null);
                            }}
                            style={{ width: 90, fontSize: 11, padding: "2px 6px", border: "1.5px solid #7c3aed", borderRadius: 6, color: "#7c3aed", fontWeight: 700, letterSpacing: 1 }}
                          />
                          <button onClick={() => { setProducts(products.map(pr => pr.id === p.id ? { ...pr, sku: editSkuVal.trim() } : pr)); setEditSkuId(null); }}
                            style={{ fontSize: 10, padding: "2px 7px", background: "#7c3aed", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700 }}>✓</button>
                          <button onClick={() => setEditSkuId(null)}
                            style={{ fontSize: 10, padding: "2px 6px", background: "#f3f4f6", border: "none", borderRadius: 5, cursor: "pointer", color: "#9ca3af" }}>✕</button>
                        </div>
                      ) : (
                        <div
                          onClick={() => { setEditSkuId(p.id); setEditSkuVal(p.sku || ""); }}
                          title="Click to edit SKU"
                          style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, marginTop: 1 }}>
                          {p.sku || <span style={{ color: "#d1d5db" }}>+ Add SKU</span>}
                          <span style={{ fontSize: 9, color: "#c4b5fd" }}>✎</span>
                        </div>
                      )}
                      {isSV && <span style={{ fontSize: 10, background: "#f0fdf4", color: "#059669", padding: "1px 6px", borderRadius: 6, fontWeight: 700, display: "block", marginTop: 2, width: "fit-content" }}>Size-wise pricing</span>}
                    </td>
                    <td><span className="badge badge-purple">{p.category}</span></td>
                    <td style={{ color: "#6b7280" }}>{p.brand}</td>
                    <td>
                      {isSV ? (
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {p.sizeVariants.map(sv => (
                            <span key={sv.size} style={{ background: "#ede9fe", color: "#7c3aed", padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              {sv.size}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {(p.sizes || []).map(s => <span key={s} style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{s}</span>)}
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td style={{ fontWeight: 600 }}>
                        {isSV ? (
                          <div style={{ fontSize: 11, color: "#6b7280" }}>
                            {p.sizeVariants.map(sv => <div key={sv.size}>Size {sv.size}: ₹{sv.purchasePrice}</div>)}
                          </div>
                        ) : `₹${p.purchasePrice}`}
                      </td>
                    )}
                    <td>
                      {isSV ? (
                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                          {p.sizeVariants.map(sv => sv.mrp > 0 ? <div key={sv.size}>Size {sv.size}: ₹{sv.mrp}</div> : null)}
                        </div>
                      ) : p.mrp > 0 ? (
                        <div>
                          <div style={{ fontWeight: 700, color: "#6b7280", textDecoration: "line-through", fontSize: 12 }}>₹{p.mrp}</div>
                          <div style={{ fontSize: 11, color: "#9ca3af" }}>{ppp > 1 ? `${ppp}-piece pack` : "per piece"}</div>
                        </div>
                      ) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </td>
                    <td>
                      {isSV ? (
                        <div style={{ fontSize: 11 }}>
                          {p.sizeVariants.map(sv => <div key={sv.size} style={{ color: "#059669", fontWeight: 700 }}>Size {sv.size}: ₹{sv.sellingPrice}</div>)}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 700, color: "#059669" }}>₹{p.sellingPrice}</div>
                          {mrpPerPiece > 0 && <div style={{ fontSize: 11, color: "#10b981" }}>MRP ₹{mrpPerPiece}/pc</div>}
                        </div>
                      )}
                    </td>
                    {isAdmin && <td><span className="badge badge-green">{margin}%</span></td>}
                    <td>
                      {isSV ? (
                        <div style={{ fontSize: 11 }}>
                          {p.sizeVariants.map(sv => (
                            <div key={sv.size}>
                              <span style={{ color: sv.stock <= 5 ? "#e11d48" : "#374151" }}>{sv.size}: {sv.stock}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className={p.quantity <= 5 ? "low-stock-badge" : "badge badge-blue"}>{p.quantity}</span>
                      )}
                    </td>
                    <td style={{ color: "#6b7280", fontSize: 12 }}>{p.supplier}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}><Icon name="edit" size={14} /></button>
                        {p.priceHistory && p.priceHistory.length > 0 && (
                          <button className="btn btn-outline btn-sm" title="Rate History dekhoo"
                            onClick={() => setPriceHistoryProduct(p)}
                            style={{ color: "#f59e0b", borderColor: "#fcd34d", fontSize: 12 }}>📈</button>
                        )}
                        {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => deleteProduct(p.id)}><Icon name="trash" size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>No products found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 620 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: editProduct ? 20 : 8 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>{editProduct ? "Edit Product" : "Add New Product"}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><Icon name="close" size={20} /></button>
            </div>
            {/* "From invoice" hint banner — show when adding a new product pre-filled from invoice */}
            {!editProduct && form.name && (
              <div style={{ background:"#fff7ed", border:"1.5px solid #fcd34d", borderRadius:10, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#92400e", display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:16 }}>🧾</span>
                <div>
                  <b>Invoice se aaya hai</b> — <b>"{form.name}"</b> ka bill ban gaya tha lekin inventory mein nahi tha.
                  Purchase Price, MRP aur Stock zaroor bharo — margin calculation ke liye zaroori hai.
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Basic info */}
              <div className="form-row form-row-2">
                <div><label className="label">Product Name *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lux Cozi Underwear" /></div>
                <div><label className="label">Category</label><select className="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
              </div>
              <div className="form-row form-row-2">
                <div><label className="label">Brand</label><input className="input" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Lux Cozi" /></div>
                <div style={{ position: "relative" }}>
                  <label className="label">Product Code ✨</label>
                  <input
                    className="input"
                    value={form.sku}
                    onChange={e => setForm({ ...form, sku: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const typed = e.target.value.trim().toLowerCase();
                        const existing = products.find(p => (p.sku||"").toLowerCase() === typed && (!editProduct || p.id !== editProduct.id));
                        if (existing) {
                          if (window.confirm(`"${typed.toUpperCase()}" code pehle se "${existing.name}" ke liye use ho raha hai.\n\nKya aap us product ko EDIT karna chahte ho?`)) {
                            setEditProduct(existing);
                            const colorsStr = Array.isArray(existing.colors) ? existing.colors.join(", ") : (existing.colors || "");
                            setForm({ name: existing.name, category: existing.category || "Shirt", brand: existing.brand || "", colors: colorsStr, supplier: existing.supplier || "", sku: existing.sku || "", purchasePrice: existing.purchasePrice || "", sellingPrice: existing.sellingPrice || "", quantity: existing.quantity || "", mrp: existing.mrp || "", piecesPerPack: existing.piecesPerPack || 1, sizes: existing.sizes || [], sizeVariants: existing.sizeVariants || [blankVariant()] });
                            setUseSizeVariants(!!(existing.sizeVariants && existing.sizeVariants.length > 0));
                          }
                        }
                      }
                    }}
                    onBlur={e => {
                      const typed = e.target.value.trim().toLowerCase();
                      if (!typed) return;
                      const existing = products.find(p => (p.sku||"").toLowerCase() === typed && (!editProduct || p.id !== editProduct.id));
                      if (existing) {
                        setSkuConflict(existing);
                      } else {
                        setSkuConflict(null);
                      }
                    }}
                    style={{ background: "#f9fafb", fontWeight: 700, letterSpacing: 1, color: "#7c3aed" }}
                    placeholder="auto-generate hoga"
                  />
                  {skuConflict && (
                    <div style={{ marginTop: 4, background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                      ⚠️ <b>"{skuConflict.sku?.toUpperCase()}"</b> code pehle se <b>{skuConflict.name}</b> ke liye exist karta hai.
                      <button onClick={() => {
                        setEditProduct(skuConflict);
                        const colorsStr = Array.isArray(skuConflict.colors) ? skuConflict.colors.join(", ") : (skuConflict.colors || "");
                        setForm({ name: skuConflict.name, category: skuConflict.category || "Shirt", brand: skuConflict.brand || "", colors: colorsStr, supplier: skuConflict.supplier || "", sku: skuConflict.sku || "", purchasePrice: skuConflict.purchasePrice || "", sellingPrice: skuConflict.sellingPrice || "", quantity: skuConflict.quantity || "", mrp: skuConflict.mrp || "", piecesPerPack: skuConflict.piecesPerPack || 1, sizes: skuConflict.sizes || [], sizeVariants: skuConflict.sizeVariants || [blankVariant()] });
                        setUseSizeVariants(!!(skuConflict.sizeVariants && skuConflict.sizeVariants.length > 0));
                        setSkuConflict(null);
                      }} style={{ marginLeft: 8, background: "#d97706", color: "white", border: "none", borderRadius: 6, padding: "2px 10px", fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
                        Us product ko edit karo →
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div><label className="label">Colors (comma separated)</label><input className="input" value={typeof form.colors === "string" ? form.colors : (form.colors || []).join(", ")} onChange={e => setForm({ ...form, colors: e.target.value })} placeholder="e.g. White, Black, Red" /></div>
              <div><label className="label">Supplier</label><input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></div>

              {/* Pricing type toggle */}
              <div style={{ background: "#f5f3ff", border: "1.5px solid #ddd6fe", borderRadius: 12, padding: "12px 14px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#6d28d9", marginBottom: 10 }}>📦 Pricing Type</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setUseSizeVariants(false)}
                    style={{ flex: 1, padding: "8px", borderRadius: 10, border: `2px solid ${!useSizeVariants ? "#7c3aed" : "#e5e7eb"}`, background: !useSizeVariants ? "#ede9fe" : "white", color: !useSizeVariants ? "#6d28d9" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                    🏷️ Simple (ek hi price sabke liye)
                  </button>
                  <button onClick={() => setUseSizeVariants(true)}
                    style={{ flex: 1, padding: "8px", borderRadius: 10, border: `2px solid ${useSizeVariants ? "#7c3aed" : "#e5e7eb"}`, background: useSizeVariants ? "#ede9fe" : "white", color: useSizeVariants ? "#6d28d9" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                    📐 Size-wise (har size ka alag price)
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                  {useSizeVariants ? "Har size ka alag purchase price, MRP, selling price aur stock." : "Sabhi sizes ke liye ek hi price. MRP optional hai."}
                </p>
              </div>

              {/* SIZE VARIANT pricing */}
              {useSizeVariants && (
                <div>
                  {/* Bulk add shortcut */}
                  <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚡ Shortcut — Ek saath kai sizes add karo</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input className="input" id="bulkSizeInput" placeholder="60,65,70,75,80" style={{ flex: 1, fontSize: 13 }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const sizes = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                            if (sizes.length === 0) return;
                            // Copy pricing from first filled row if available
                            const firstFilled = form.sizeVariants.find(sv => sv.purchasePrice || sv.sellingPrice);
                            const newRows = sizes.map(s => ({
                              ...blankVariant(),
                              size: s,
                              purchasePrice: firstFilled?.purchasePrice || "",
                              mrp: firstFilled?.mrp || "",
                              piecesPerBox: firstFilled?.piecesPerBox || "",
                              sellingPrice: firstFilled?.sellingPrice || "",
                            }));
                            setForm(f => ({ ...f, sizeVariants: [...f.sizeVariants.filter(sv => sv.size), ...newRows] }));
                            e.target.value = "";
                          }
                        }} />
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap" }}
                        onClick={() => {
                          const inp = document.getElementById("bulkSizeInput");
                          const sizes = inp.value.split(",").map(s => s.trim()).filter(Boolean);
                          if (sizes.length === 0) return;
                          const firstFilled = form.sizeVariants.find(sv => sv.purchasePrice || sv.sellingPrice);
                          const newRows = sizes.map(s => ({
                            ...blankVariant(),
                            size: s,
                            purchasePrice: firstFilled?.purchasePrice || "",
                            mrp: firstFilled?.mrp || "",
                            piecesPerBox: firstFilled?.piecesPerBox || "",
                            sellingPrice: firstFilled?.sellingPrice || "",
                          }));
                          setForm(f => ({ ...f, sizeVariants: [...f.sizeVariants.filter(sv => sv.size), ...newRows] }));
                          inp.value = "";
                        }}>
                        + Add Rows
                      </button>
                    </div>
                    <p style={{ fontSize: 10, color: "#b45309", marginTop: 4 }}>💡 Tip: Pehle ek row mein Purchase/MRP/Selling price bharo → phir sizes add karo — sab rows mein same price auto-copy ho jaayega. Stock manually bharna hoga.</p>
                    {/* Quick copy buttons */}
                    {form.sizeVariants.some(sv => sv.purchasePrice || sv.sellingPrice) && (
                      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-outline" style={{ fontSize: 11, padding: "3px 10px" }}
                          onClick={() => {
                            const first = form.sizeVariants.find(sv => sv.purchasePrice || sv.sellingPrice);
                            if (!first) return;
                            setForm(f => ({ ...f, sizeVariants: f.sizeVariants.map(sv => ({
                              ...sv,
                              purchasePrice: first.purchasePrice || sv.purchasePrice,
                              mrp: first.mrp || sv.mrp,
                              piecesPerBox: first.piecesPerBox || sv.piecesPerBox,
                              sellingPrice: first.sellingPrice || sv.sellingPrice,
                            })) }));
                          }}>
                          📋 Pehli row ka price sab mein copy karo
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <label className="label" style={{ margin: 0 }}>Size-wise Pricing & Stock</label>
                    <button onClick={addVariantRow} className="btn btn-outline" style={{ fontSize: 12, padding: "4px 12px" }}>+ Ek Row Add</button>
                  </div>
                  {/* Header */}
                  <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 90px 70px 1fr 72px 28px", gap: 5, marginBottom: 4 }}>
                    {["Size", "Purchase ₹", "Box MRP ₹", "Piece in box?", "Selling/piece ₹", "Stock", ""].map(h => (
                      <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textAlign: "center" }}>{h}</div>
                    ))}
                  </div>
                  {form.sizeVariants.map((sv, i) => {
                    const perPcMrp = sv.mrp > 0 && sv.piecesPerBox > 0 ? Math.round(sv.mrp / sv.piecesPerBox) : (sv.mrp > 0 ? sv.mrp : 0);
                    const discPerPc = perPcMrp > 0 && sv.sellingPrice > 0 ? perPcMrp - +sv.sellingPrice : 0;
                    return (
                      <div key={i}>
                        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 90px 70px 1fr 72px 28px", gap: 5, marginBottom: 2, alignItems: "center" }}>
                          <input className="input" value={sv.size} onChange={e => updateVariant(i, "size", e.target.value)} placeholder="60" style={{ textAlign: "center", fontWeight: 700, padding: "6px 4px" }} />
                          <input className="input" type="number" onWheel={e=>e.target.blur()} value={sv.purchasePrice} onChange={e => updateVariant(i, "purchasePrice", e.target.value)} placeholder="₹" style={{ padding: "6px 4px" }} />
                          <input className="input" type="number" onWheel={e=>e.target.blur()} value={sv.mrp} onChange={e => updateVariant(i, "mrp", e.target.value)} placeholder="336" style={{ padding: "6px 4px" }} />
                          <input className="input" type="number" onWheel={e=>e.target.blur()} value={sv.piecesPerBox || ""} onChange={e => updateVariant(i, "piecesPerBox", e.target.value)} placeholder="2" style={{ padding: "6px 4px", textAlign: "center" }} />
                          <input className="input" type="number" onWheel={e=>e.target.blur()} value={sv.sellingPrice} onChange={e => updateVariant(i, "sellingPrice", e.target.value)} placeholder="₹ *" style={{ padding: "6px 4px", border: !sv.sellingPrice ? "1.5px solid #fca5a5" : undefined }} />
                          <input className="input" type="number" onWheel={e=>e.target.blur()} value={sv.stock} onChange={e => updateVariant(i, "stock", e.target.value)} placeholder="0" style={{ padding: "6px 4px", textAlign: "center" }} />
                          <button onClick={() => removeVariantRow(i)} disabled={form.sizeVariants.length === 1}
                            style={{ background: "none", border: "none", cursor: form.sizeVariants.length === 1 ? "not-allowed" : "pointer", color: "#ef4444", fontSize: 18, lineHeight: 1, opacity: form.sizeVariants.length === 1 ? 0.3 : 1 }}>×</button>
                        </div>
                        {/* Per-row hint */}
                        {(perPcMrp > 0 || sv.sellingPrice) && (
                          <div style={{ fontSize: 10, color: "#7c3aed", marginBottom: 6, paddingLeft: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                            {perPcMrp > 0 && <span>📦 MRP/piece: <b>₹{perPcMrp}</b>{sv.piecesPerBox > 1 ? ` (box ₹${sv.mrp} ÷ ${sv.piecesPerBox}pc)` : ""}</span>}
                            {discPerPc > 0 && <span style={{ color: "#059669" }}>💰 Customer saves: <b>₹{discPerPc}/piece</b></span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Summary */}
                  {form.sizeVariants.some(sv => sv.sellingPrice) && (
                    <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, color: "#059669", marginTop: 6 }}>
                      💡 Total stock: {form.sizeVariants.reduce((a, sv) => a + (+sv.stock || 0), 0)} pieces •
                      Price range: ₹{Math.min(...form.sizeVariants.filter(sv => sv.sellingPrice).map(sv => +sv.sellingPrice))} – ₹{Math.max(...form.sizeVariants.filter(sv => sv.sellingPrice).map(sv => +sv.sellingPrice))}
                    </div>
                  )}
                </div>
              )}

              {/* SIMPLE pricing */}
              {!useSizeVariants && (
                <>
                  <div>
                    <label className="label">Available Sizes (optional)</label>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 6 }}>
                      {allSizes.map(s => (
                        <button key={s} onClick={() => toggleSize(s)} style={{ padding: "5px 12px", borderRadius: 8, border: form.sizes.includes(s) ? "2px solid #7c3aed" : "1.5px solid #e5e7eb", background: form.sizes.includes(s) ? "#f5f3ff" : "white", color: form.sizes.includes(s) ? "#7c3aed" : "#6b7280", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>{s}</button>
                      ))}
                    </div>
                  </div>
                  <div className="form-row form-row-3">
                    <div><label className="label">Purchase Price ₹</label><input className="input" type="number" onWheel={e=>e.target.blur()} value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} placeholder="450" /></div>
                    <div><label className="label">Selling Price ₹ *</label><input className="input" type="number" onWheel={e=>e.target.blur()} value={form.sellingPrice} onChange={e => setForm({ ...form, sellingPrice: e.target.value })} placeholder="120" /></div>
                    <div><label className="label">Quantity *</label><input className="input" type="number" onWheel={e=>e.target.blur()} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="50" /></div>
                  </div>
                  <div style={{ background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 12, padding: "14px 16px" }}>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed", marginBottom: 10 }}>📦 Pack / MRP Info (optional)</p>
                    <div className="form-row form-row-2">
                      <div>
                        <label className="label">Company MRP ₹ (box/pack ka)</label>
                        <input className="input" type="number" onWheel={e=>e.target.blur()} value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} placeholder="e.g. 336" />
                      </div>
                      <div>
                        <label className="label">Ek Pack mein kitne Piece</label>
                        <input className="input" type="number" onWheel={e=>e.target.blur()} value={form.piecesPerPack} onChange={e => setForm({ ...form, piecesPerPack: e.target.value })} placeholder="2" min="1" />
                      </div>
                    </div>
                    {form.mrp > 0 && form.piecesPerPack > 0 && form.sellingPrice > 0 && (
                      <div style={{ marginTop: 10, background: "#ede9fe", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#5b21b6", fontWeight: 600 }}>
                        💡 MRP per piece: ₹{Math.round(form.mrp / form.piecesPerPack)} | Tumhara rate: ₹{form.sellingPrice}/piece | Customer savings: ₹{Math.round(form.mrp / form.piecesPerPack) - +form.sellingPrice}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveProduct}>{editProduct ? "Update Product" : "Add Product"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {priceHistoryProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="card" style={{ width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto", position: "relative" }}>
            <button onClick={() => setPriceHistoryProduct(null)} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>×</button>
            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📈 Rate History</h3>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, fontWeight: 600 }}>{priceHistoryProduct.name}</p>
            {(priceHistoryProduct.priceHistory || []).length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 13 }}>Koi price history nahi hai abhi. Purchase add karo toh history track hogi.</p>
            ) : (
              <table className="table" style={{ fontSize: 12 }}>
                <thead><tr>
                  <th>Date</th><th>Supplier</th><th>Purchase ₹</th><th>MRP ₹</th><th>Qty</th>
                </tr></thead>
                <tbody>
                  {[...( priceHistoryProduct.priceHistory || [])].reverse().map((h, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{(() => { try { const d = new Date(h.date); return isNaN(d) ? h.date : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); } catch { return h.date; } })()}</td>
                      <td>{h.supplier || "—"}</td>
                      <td style={{ fontWeight: 700, color: "#dc2626" }}>₹{h.purchasePrice}</td>
                      <td style={{ color: "#6b7280" }}>{h.mrp ? `₹${h.mrp}` : "—"}</td>
                      <td><span className="badge badge-blue">{h.qty} pcs</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>
              💡 Har purchase ke saath supplier ka rate automatically record hota hai
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// BILLING / POS
// ============================================================
const Billing = ({ products, setProducts, sales, setSales, customers, setCustomers, showToast, billCounter, setBillCounter, shopName, isAdmin, setActiveTab, setHighlightPhone, setGlobalInvoiceSale }) => {
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [cart, setCart] = useState([]);
  const [discountType, setDiscountType] = useState("₹");
  const [discountVal, setDiscountVal] = useState("");
  const [tax, setTax] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerRegion, setCustomerRegion] = useState(""); // "local" | "out-city" | "out-state"
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [receivedAmt, setReceivedAmt] = useState("");
  const [showSettleModal, setShowSettleModal] = useState(false); // shortfall settle modal
  const [settleAmounts, setSettleAmounts] = useState({}); // { cartItemId: amountLess }
  const [showInvoice, setShowInvoice] = useState(null);
  const [saleInProgress, setSaleInProgress] = useState(false); // BUG29 FIX: double-click guard
  // Quick-add row
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("");
  const [quickQty, setQuickQty] = useState(1);
  const [codeSearch, setCodeSearch] = useState("");
  const [showCodeDrop, setShowCodeDrop] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null); // for size-variant price lookup
  const [selectedVariant, setSelectedVariant] = useState(null); // current size variant

  const getCustomerSales = (phone) => sales.filter(s => s.phone === phone);
  const [quickSize, setQuickSize] = useState("");
  const [quickColor, setQuickColor] = useState("");
  const searchRef = useRef(null);
  const [dropdownIdx, setDropdownIdx] = useState(-1); // keyboard nav
  const [codeDropdownIdx, setCodeDropdownIdx] = useState(-1);

  // BUG19 FIX: useMemo — filteredProducts har render pe recalculate nahi hoga
  const filteredProducts = React.useMemo(() => products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku || "").toLowerCase().includes(search.toLowerCase())
  ), [products, search]);

  // When user picks product from dropdown — pre-fill quick-add row
  const selectProduct = (p) => {
    const isSV = p.pricingType === "size-variant" && p.sizeVariants?.length > 0;
    const firstVariant = isSV ? p.sizeVariants[0] : null;
    setQuickName(p.name);
    setQuickPrice(isSV ? firstVariant.sellingPrice : p.sellingPrice);
    setQuickSize(isSV ? firstVariant.size : (p.sizes || [])[0] || "");
    setQuickColor((p.colors || [])[0] || "");
    setQuickQty(1);
    setSearch(p.name);
    setShowDropdown(false);
    setSelectedProduct(p);
    setSelectedVariant(isSV ? firstVariant : null);
  };

  // When size changes on a size-variant product — update price + mrp automatically
  const onSizeChange = (newSize) => {
    setQuickSize(newSize);
    if (selectedProduct?.pricingType === "size-variant") {
      const variant = selectedProduct.sizeVariants.find(sv => sv.size === newSize);
      if (variant) {
        setQuickPrice(variant.sellingPrice);
        // store mrp info on a ref so addToCart can use it
        setSelectedVariant(variant);
      }
    }
  };

  // Add item to cart — works for both existing product and manual entry
  const addToCart = () => {
    if (!quickName || !quickPrice) { showToast("Product naam aur price dalo", "error"); return; }
    // BUG30 FIX: price 0 ya negative pe sale block karo
    if (+quickPrice <= 0) { showToast("Price ₹0 nahi ho sakta!", "error"); return; }
    const matchedProduct = products.find(p => p.name.toLowerCase() === quickName.toLowerCase() && p.sellingPrice === +quickPrice);
    const newItem = {
      cartItemId: Date.now() + Math.random(), // unique ID — never merge items
      productId: matchedProduct ? matchedProduct.id : null,
      name: quickName,
      sku: matchedProduct?.sku || selectedProduct?.sku || "",
      size: quickSize || "-",
      color: quickColor || "-",
      qty: +quickQty || 1,
      price: +quickPrice,
      // MRP info — from size variant if available, else from product
      mrpPerPiece: selectedVariant?.mrpPerPiece || (matchedProduct?.mrp > 0 && matchedProduct?.piecesPerPack > 0 ? Math.round(matchedProduct.mrp / matchedProduct.piecesPerPack) : 0),
      mrp: selectedVariant?.mrp || matchedProduct?.mrp || 0,
      piecesPerBox: selectedVariant?.piecesPerBox || matchedProduct?.piecesPerPack || 1,
    };
    // BUG31 FIX: same name+size+color already cart mein hai? confirm karo
    const existing = cart.find(it =>
      it.name.toLowerCase() === newItem.name.toLowerCase() &&
      it.size === newItem.size &&
      it.color === newItem.color &&
      it.price === newItem.price
    );
    if (existing) {
      // Confirm se qty badhaao — accidental duplicate prevent karo
      if (window.confirm(`"${newItem.name}" (${newItem.size}/${newItem.color}) already cart mein hai.\n\nQty badhaao? (OK = qty add, Cancel = alag row banana)`)) {
        setCart(prev => prev.map(it =>
          it.cartItemId === existing.cartItemId ? { ...it, qty: it.qty + newItem.qty } : it
        ));
        setQuickName(""); setQuickPrice(""); setQuickQty(1); setQuickSize(""); setQuickColor(""); setSearch(""); setSelectedProduct(null); setSelectedVariant(null);
        showToast(`Qty update ho gaya! ✓`);
        searchRef.current?.focus();
        return;
      }
      // Cancel = duplicate row allow (intentional)
    }
    setCart(prev => [...prev, newItem]);
    setQuickName(""); setQuickPrice(""); setQuickQty(1); setQuickSize(""); setQuickColor(""); setSearch(""); setSelectedProduct(null); setSelectedVariant(null);
    showToast("Cart mein add ho gaya! ✓");
    searchRef.current?.focus();
  };

  // ─────────────────────────────────────────────────────────────
  // CORRECT DISCOUNT LOGIC:
  // • Item-wise discount  → sirf us item pe, alag se
  // • Bill-level discount → sirf un items pe jinhone item discount NAHI liya
  // ─────────────────────────────────────────────────────────────

  // Each item's MRP total — use mrpPerPiece if set, else selling price
  const itemMRP = (item) => (item.mrpPerPiece > 0 ? item.mrpPerPiece : item.price) * item.qty;

  // Each item's rate total (our selling price)
  const itemRate = (item) => item.price * item.qty;

  // MRP discount on an item (difference between MRP and our rate)
  const itemMRPDisc = (item) => item.mrpPerPiece > item.price ? (item.mrpPerPiece - item.price) * item.qty : 0;

  // Resolve item discount in ₹ (supports ₹, % and =₹ target price mode)
  // Item discount is applied on top of selling price (rate), not MRP
  const resolveItemDisc = (item) => {
    // =₹ mode: handle FIRST — target price can be 0 (100% disc)
    if (item.itemDiscountType === "=₹") {
      const t = item.itemDiscount;
      if (t === undefined || t === null || t === "") return 0;
      const disc = itemRate(item) - (+t);
      return disc > 0 ? disc : 0;
    }
    const val = item.itemDiscount || 0;
    if (!val) return 0;
    if (item.itemDiscountType === "%") return Math.round(itemRate(item) * val / 100);
    // ₹ mode: cap at itemRate so we never go negative
    return Math.min(val, itemRate(item));
  };

  // Items jo item-level discount le rahe hain
  // BUG2 FIX: sirf resolveItemDisc use karo — itemDiscount raw field check karna galat tha
  // BUG3 FIX: priceFixed items bhi bill discount se exempt hain
  const itemsWithItemDisc = cart.filter(it => resolveItemDisc(it) > 0);
  const itemsWithoutItemDisc = cart.filter(it => resolveItemDisc(it) === 0 && !it.priceFixed);

  // Total item-wise discounts (resolved ₹)
  const itemDiscountTotal = cart.reduce((a, b) => a + resolveItemDisc(b), 0);

  // MRP total (what customer would pay at full MRP)
  const mrpTotal = cart.reduce((a, b) => a + itemMRP(b), 0);

  // Rate subtotal (our selling price × qty) — this is the actual base
  const subtotal = cart.reduce((a, b) => a + itemRate(b), 0);

  // MRP savings = difference between MRP total and rate total
  const mrpDiscountTotal = cart.reduce((a, b) => a + itemMRPDisc(b), 0);

  // Subtotal of items that CAN get bill discount (those without item-wise disc) — based on rate
  const subtotalEligibleForBillDisc = itemsWithoutItemDisc.reduce((a, b) => a + itemRate(b), 0);

  // Bill-level discount — applied ONLY on items without item-wise discount
  // BUG12 FIX: agar koi bhi item eligible nahi (sab pe item-disc ya priceFixed) toh discountAmt = 0
  // subtotalEligibleForBillDisc === 0 pe koi bhi bill discount apply nahi honi chahiye
  const discountAmt = discountVal && subtotalEligibleForBillDisc > 0
    ? (discountType === "%"
        ? Math.round(subtotalEligibleForBillDisc * (+discountVal / 100))
        : Math.min(+discountVal, subtotalEligibleForBillDisc))
    : 0;

  // Tax on the net amount after all discounts (on rate, not MRP)
  // BUG32 FIX: taxAmt already Math.round — sirf ek hi rounding point hai, accumulation nahi
  // netBeforeTax integer hai (subtotal, itemDiscTotal, discountAmt sab integers), toh sahi hai
  const netBeforeTax = subtotal - itemDiscountTotal - discountAmt;
  const taxAmt = tax ? Math.round(netBeforeTax * (+tax / 100)) : 0;
  const afterDiscountTax = netBeforeTax + taxAmt;

  // Extra discount from received amount (customer ne kam diya)
  const received = receivedAmt !== "" ? +receivedAmt : null;
  const extraDiscount = received !== null && received < afterDiscountTax ? afterDiscountTax - received : 0;
  // BUG4 FIX: totalDiscount = sirf actual discounts (item + bill), extraDiscount alag track karo
  // extraDiscount savings mein count nahi hoga — woh sirf "kam mila" hai, discount nahi
  const totalDiscount = itemDiscountTotal + discountAmt;
  const finalTotal = received !== null ? Math.min(received, afterDiscountTax) : afterDiscountTax;

  // Per-item effective price = rate - itemDisc - billDisc (if eligible)
  // BUG3 FIX: priceFixed items ka price koi bhi discount change nahi karega
  // BUG13 FIX: settleAmounts aur billDisc dono saath apply ho rahe the — double deduction
  // Correct order: rate → itemDisc → billDisc → settled (ek ke baad ek, double nahi)
  const getItemEffectiveTotal = (item) => {
    const rate = itemRate(item);
    const iDisc = resolveItemDisc(item);
    const afterItemDisc = iDisc > 0 ? Math.max(0, rate - iDisc) : rate;
    // priceFixed item pe bill discount aur settle nahi lagega
    if (item.priceFixed) return afterItemDisc;
    const ratio = subtotalEligibleForBillDisc > 0 ? discountAmt / subtotalEligibleForBillDisc : 0;
    // BUG13 FIX: billDisc sirf tab lagao jab item discount nahi hai
    const afterBillDisc = iDisc > 0 ? afterItemDisc : Math.max(0, afterItemDisc - Math.round(rate * ratio));
    // BUG13 FIX: settled = item-specific partial payment shortfall
    // Yeh billDisc ke BAAD apply hota hai — alag cheez hai, bill discount nahi
    // Pehle dono ek saath apply hote the causing double deduction
    const settled = settleAmounts[item.cartItemId] || 0;
    // settled sirf tab relevant hai jab koi extraDiscount hai (customer ne kam diya)
    // Normal case mein settled = 0, toh koi fark nahi
    return Math.max(0, afterBillDisc - settled);
  };

  const totalSettled = Object.values(settleAmounts).reduce((a, b) => a + (+b || 0), 0);

  const completeSale = () => {
    if (saleInProgress) return; // BUG29 FIX: double-click guard
    if (cart.length === 0) { showToast("Cart khali hai", "error"); return; }
    // BUG30 FIX: ₹0 cart complete nahi hona chahiye
    if (finalTotal <= 0 && cart.some(it => it.price > 0)) { showToast("Bill total ₹0 nahi ho sakta!", "error"); return; }
    if (extraDiscount > 0 && Math.abs(totalSettled - extraDiscount) > 0) {
      setShowSettleModal(true);
      return;
    }
    finalizeSale();
  };

  const finalizeSale = async () => {
    setSaleInProgress(true); // BUG29 FIX: lock button immediately
    // BUG24 FIX: billCounter race condition — Firebase transaction use karo
    // Do log saath bill banayein toh same INV number nahi milega
    let finalBillCounter = billCounter;
    try {
      const counterRef = doc(db, "meta", "billCounter");
      await runTransaction(db, async (txn) => {
        const snap = await txn.get(counterRef);
        finalBillCounter = snap.exists() ? (snap.data().value || billCounter) : billCounter;
        txn.set(counterRef, { value: finalBillCounter + 1 });
      });
    } catch (e) {
      // Offline ya error — local counter use karo (fallback)
      finalBillCounter = billCounter;
    }
    setBillCounter(finalBillCounter + 1); // sync local state (BUG29 fix: was setBillCounterState — wrong scope)

    const billNo = `INV-${String(finalBillCounter).padStart(3, "0")}`;
    const itemsWithEff = cart.map(item => ({
      ...item,
      itemDiscountRs: resolveItemDisc(item),
      effectiveTotal: getItemEffectiveTotal(item),
      settledDisc: settleAmounts[item.cartItemId] || 0,
    }));
    const v0 = {
      versionNo: 1, type: "original",
      date: new Date().toISOString(),
      items: itemsWithEff,
      subtotal: mrpTotal,          // MRP total (mrpPerPiece×qty or price×qty)
      rateSubtotal: subtotal,      // our selling price total
      mrpDiscountTotal,            // MRP savings amount
      itemDiscountTotal,
      billDiscount: discountAmt,
      // BUG11 FIX: 'discount' field sirf version mein store karo
      // sale top-level pe ...v0 spread se already aa jaayega — alag se set karna inconsistency banata tha
      discount: totalDiscount,
      tax: taxAmt,
      total: finalTotal,
      received: received ?? finalTotal,
      note: "Original bill",
    };
    // BUG11 FIX: sale object mein ...v0 spread hai — discount field automatically version se aayega
    // Duplicate top-level discount field nahi chahiye — version hi source of truth hai
    const { discount: _d, ...v0WithoutDiscount } = v0; // eslint-disable-line no-unused-vars
    const sale = {
      id: Date.now(), billNo,
      customer: customerName || "Walk-in",
      phone: customerPhone,
      region: customerRegion || "",
      versions: [v0], currentVersion: 0,
      ...v0WithoutDiscount,
    };
    setSales([...sales, sale]);
    // BUG8 FIX: size-variant products ke liye sizeVariants[].stock bhi deduct karo
    cart.forEach(item => {
      if (!item.productId) return;
      setProducts(prev => prev.map(p => {
        if (p.id !== item.productId) return p;
        const newQty = Math.max(0, p.quantity - item.qty);
        // Agar size-variant product hai aur item ka size set hai
        if (p.pricingType === "size-variant" && item.size && item.size !== "-" && p.sizeVariants?.length) {
          const newVariants = p.sizeVariants.map(sv =>
            sv.size === item.size
              ? { ...sv, stock: Math.max(0, (sv.stock || 0) - item.qty) }
              : sv
          );
          return { ...p, quantity: newQty, sizeVariants: newVariants };
        }
        return { ...p, quantity: newQty };
      }));
    });
    if (customerName && customerPhone) {
      const existing = customers.find(c => c.phone === customerPhone);
      if (existing) setCustomers(customers.map(c => c.phone === customerPhone ? { ...c, totalSpent: c.totalSpent + finalTotal, visits: c.visits + 1, region: customerRegion || c.region } : c));
      else setCustomers([...customers, { id: Date.now(), name: customerName, phone: customerPhone, email: "", totalSpent: finalTotal, visits: 1, region: customerRegion || "" }]);
    }
    // BUG24: setBillCounter now handled via transaction above
    setShowInvoice(sale);
    setCart([]); setDiscountVal(""); setDiscountType("₹"); setTax(""); setCustomerName(""); setCustomerPhone(""); setCustomerRegion(""); setReceivedAmt(""); setSettleAmounts({}); setShowSettleModal(false);
    setSaleInProgress(false); // BUG29 FIX: unlock after sale complete
  };

  return (
    <div className="page" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
      {/* Left: Quick Add + Cart */}
      <div>
        {/* Fast Entry Row */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>⚡ Fast Billing</h3>
            <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "3px 10px", borderRadius: 20 }}>Inventory product ya naya — dono chalega</span>
          </div>

          {/* Search bar — 2 separate fields: Naam search + Code search */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {/* Naam se search */}
            <div style={{ position: "relative" }}>
              <label className="label" style={{ fontSize:11, marginBottom:3 }}>🔍 Naam se Dhundo</label>
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  ref={searchRef}
                  className="input"
                  style={{ paddingLeft: 32, fontSize:13 }}
                  placeholder="Product naam... (↑↓ navigate)"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setQuickName(e.target.value); setShowDropdown(true); setCodeSearch(""); setDropdownIdx(-1); }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => { setShowDropdown(false); setDropdownIdx(-1); }, 180)}
                  onKeyDown={e => {
                    const nr = filteredProducts.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
                    if (!showDropdown || nr.length === 0) { if (e.key === "Enter") addToCart(); return; }
                    if (e.key === "ArrowDown") { e.preventDefault(); setDropdownIdx(i => Math.min(i + 1, nr.length - 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setDropdownIdx(i => Math.max(i - 1, 0)); }
                    else if (e.key === "Enter" || e.key === "Tab") {
                      if (dropdownIdx >= 0 && dropdownIdx < nr.length) {
                        e.preventDefault(); selectProduct(nr[dropdownIdx]); setDropdownIdx(-1); setShowDropdown(false);
                      } else if (e.key === "Enter") { addToCart(); }
                    } else if (e.key === "Escape") { setShowDropdown(false); setDropdownIdx(-1); }
                  }}
                />
              </div>
              {showDropdown && search && filteredProducts.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1.5px solid #e5e7eb", borderRadius: 12, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
                  {filteredProducts.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).map((p, idx) => (
                    <div key={p.id} onMouseDown={() => selectProduct(p)}
                      style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center", background: idx === dropdownIdx ? "#f5f3ff" : "white", borderLeft: idx === dropdownIdx ? "3px solid #7c3aed" : "3px solid transparent" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}
                          {p.sku && <span style={{ color: "#7c3aed", fontSize: 10.5, marginLeft: 6, fontWeight: 700, background: "#f5f3ff", padding: "1px 5px", borderRadius: 4 }}>{p.sku}</span>}
                        </div>
                        <span style={{ color: "#9ca3af", fontSize: 11 }}>{p.category}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: p.quantity <= 5 ? "#e11d48" : "#059669", fontWeight: 700 }}>Stock: {p.quantity}</span>
                        <span style={{ fontWeight: 800, color: "#7c3aed", fontSize:13 }}>₹{p.sellingPrice}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: "4px 14px", fontSize: 10, color: "#9ca3af", borderTop: "1px solid #f3f4f6" }}>↑↓ navigate • Tab/Enter select • Esc band karo</div>
                </div>
              )}
            </div>
            {/* Code/SKU se search */}
            <div style={{ position: "relative" }}>
              <label className="label" style={{ fontSize:11, marginBottom:3 }}>🏷️ Code (SKU) se Dhundo</label>
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/></svg>
                <input
                  className="input"
                  style={{ paddingLeft: 32, fontSize:13 }}
                  placeholder="SKU code... (↑↓ navigate)"
                  value={codeSearch}
                  onChange={e => { setCodeSearch(e.target.value); setShowCodeDrop(true); setSearch(""); setCodeDropdownIdx(-1); }}
                  onFocus={() => setShowCodeDrop(true)}
                  onBlur={() => setTimeout(() => { setShowCodeDrop(false); setCodeDropdownIdx(-1); }, 180)}
                  onKeyDown={e => {
                    const cr = filteredProducts.filter(p => (p.sku||"").toLowerCase().includes(codeSearch.toLowerCase()));
                    if (!showCodeDrop || cr.length === 0) { if (e.key === "Enter") addToCart(); return; }
                    if (e.key === "ArrowDown") { e.preventDefault(); setCodeDropdownIdx(i => Math.min(i + 1, cr.length - 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setCodeDropdownIdx(i => Math.max(i - 1, 0)); }
                    else if (e.key === "Enter" || e.key === "Tab") {
                      if (codeDropdownIdx >= 0 && codeDropdownIdx < cr.length) {
                        e.preventDefault(); selectProduct(cr[codeDropdownIdx]); setCodeSearch(""); setCodeDropdownIdx(-1); setShowCodeDrop(false);
                      } else if (e.key === "Enter") { addToCart(); }
                    } else if (e.key === "Escape") { setShowCodeDrop(false); setCodeDropdownIdx(-1); }
                  }}
                />
              </div>
              {showCodeDrop && codeSearch && filteredProducts.filter(p => (p.sku||"").toLowerCase().includes(codeSearch.toLowerCase())).length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1.5px solid #e5e7eb", borderRadius: 12, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
                  {filteredProducts.filter(p => (p.sku||"").toLowerCase().includes(codeSearch.toLowerCase())).map((p, idx) => (
                    <div key={p.id} onMouseDown={() => { selectProduct(p); setCodeSearch(""); }}
                      style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center", background: idx === codeDropdownIdx ? "#f5f3ff" : "white", borderLeft: idx === codeDropdownIdx ? "3px solid #7c3aed" : "3px solid transparent" }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                        <span style={{ color: "#7c3aed", fontSize: 11, marginLeft: 6, fontWeight:700 }}>{p.sku}</span>
                        <span style={{ color: "#9ca3af", fontSize: 11, marginLeft: 4 }}>{p.category}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: p.quantity <= 5 ? "#e11d48" : "#059669", fontWeight: 700 }}>Stock: {p.quantity}</span>
                        <span style={{ fontWeight: 800, color: "#7c3aed", fontSize:13 }}>₹{p.sellingPrice}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: "4px 14px", fontSize: 10, color: "#9ca3af", borderTop: "1px solid #f3f4f6" }}>↑↓ navigate • Tab/Enter select • Esc band karo</div>
                </div>
              )}
            </div>
          </div>

          {/* Quick entry fields — all optional except name+price */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <label className="label">Product Naam *</label>
              <input className="input" value={quickName} onChange={e => setQuickName(e.target.value)} placeholder="Naam likhoo" onKeyDown={e => e.key === "Enter" && addToCart()} />
            </div>
            <div>
              <label className="label">Rate ₹ *</label>
              <input className="input" type="number" onWheel={e=>e.target.blur()} value={quickPrice} onChange={e => setQuickPrice(e.target.value)} placeholder="0" onKeyDown={e => e.key === "Enter" && addToCart()} />
            </div>
            <div>
              <label className="label">Qty</label>
              <input className="input" type="number" onWheel={e=>e.target.blur()} min="1" value={quickQty} onChange={e => setQuickQty(e.target.value)} onKeyDown={e => e.key === "Enter" && addToCart()} />
            </div>
            <div>
              <label className="label">Size <span style={{ color: "#d1d5db", fontWeight: 400 }}>(opt.)</span></label>
              {selectedProduct?.pricingType === "size-variant" ? (
                <select className="select" value={quickSize} onChange={e => onSizeChange(e.target.value)}>
                  {selectedProduct.sizeVariants.map(sv => (
                    <option key={sv.size} value={sv.size}>
                      {sv.size} — ₹{sv.sellingPrice}{sv.mrp > 0 ? ` (MRP ₹${sv.mrp})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" value={quickSize} onChange={e => setQuickSize(e.target.value)} placeholder="M / 32" onKeyDown={e => e.key === "Enter" && addToCart()} />
              )}
            </div>
            <div>
              <label className="label">Color <span style={{ color: "#d1d5db", fontWeight: 400 }}>(opt.)</span></label>
              <input className="input" value={quickColor} onChange={e => setQuickColor(e.target.value)} placeholder="Blue" onKeyDown={e => e.key === "Enter" && addToCart()} />
            </div>
            <button className="btn btn-primary" onClick={addToCart} style={{ height: 42, padding: "0 18px", whiteSpace: "nowrap" }}>
              <Icon name="plus" size={16} /> Add
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 8 }}>💡 Tip: Size aur Color optional hai — direct naam aur price daalo, Enter dabao, ho gaya!</p>
        </div>

        {/* Cart Table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>🛒 Cart — {cart.length} item{cart.length !== 1 ? "s" : ""}</h3>
            {cart.length > 0 && <button className="btn btn-danger btn-sm" onClick={() => setCart([])}>Clear All</button>}
          </div>
          <div className="table-scroll-wrap" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table className="table">
              {/* BUG1 FIX: thead add kiya — columns clearly dikhenge mobile pe bhi */}
              <thead>
                <tr>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 12px" }}>Product</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}>Size</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}>Color</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}>Qty</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}>Rate / MRP</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}>Item Discount</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}>Net Total</th>
                  <th style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "8px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item, i) => {
                  const itemDiscRs = resolveItemDisc(item);
                  const hasItemDisc = itemDiscRs > 0;
                  // BUG2 FIX: billDisc only for items where resolveItemDisc === 0
                  // ratio = discountAmt / subtotalEligibleForBillDisc (rate-based, not mrp)
                  const rateTotal = itemRate(item);
                  const netAfterItemDisc = Math.max(0, rateTotal - itemDiscRs);
                  // BUG3 FIX: priceFixed item pe bill discount preview nahi dikhega
                  const billDiscPreview = !hasItemDisc && !item.priceFixed && discountAmt > 0 && subtotalEligibleForBillDisc > 0
                    ? Math.round(rateTotal * (discountAmt / subtotalEligibleForBillDisc))
                    : 0;
                  const finalNet = Math.max(0, netAfterItemDisc - billDiscPreview);

                  return (
                  <tr key={i} style={{ background: item.priceFixed ? "#fffbeb" : hasItemDisc ? "#f0fdf4" : undefined }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.name}
                        {item.sku && <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, background: "#f5f3ff", padding: "1px 5px", borderRadius: 4, marginLeft: 5 }}>{item.sku}</span>}
                        {/* BUG3 FIX: priceFixed badge */}
                        {item.priceFixed && <span style={{ fontSize: 9, color: "#b45309", fontWeight: 700, background: "#fef3c7", border: "1px solid #fcd34d", padding: "1px 5px", borderRadius: 4, marginLeft: 5 }}>🔒 Fixed</span>}
                      </div>
                      {!item.productId && <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>Manual Entry</div>}
                      {item.mrp > 0 && item.piecesPerPack > 1 && (
                        <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600 }}>
                          📦 Company MRP: ₹{item.mrp} ({item.piecesPerPack}pc pack)
                        </div>
                      )}
                      {item.mrp > 0 && item.piecesPerPack === 1 && (
                        <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600 }}>
                          🏷️ Company MRP: ₹{item.mrp}/piece
                        </div>
                      )}
                      {item.priceFixed
                        ? <div style={{ fontSize: 10, color: "#b45309", fontWeight: 700 }}>🔒 Price fixed — koi bhi discount nahi lagega</div>
                        : hasItemDisc
                          ? <div style={{ fontSize: 10, color: "#059669", fontWeight: 700 }}>✓ Item discount — bill disc nahi lagega</div>
                          : discountAmt > 0
                            ? <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600 }}>📋 Bill discount lagega</div>
                            : null
                      }
                    </td>
                    <td>{item.size !== "-" ? <span className="badge badge-blue">{item.size}</span> : <span style={{ color: "#d1d5db" }}>—</span>}</td>
                    <td>{item.color !== "-" ? item.color : <span style={{ color: "#d1d5db" }}>—</span>}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={() => {
                          if (item.qty > 1) setCart(prev => prev.map((it,j) => j===i ? {...it, qty: it.qty-1} : it));
                          else setCart(prev => prev.filter((_,j) => j!==i));
                        }} style={{ width: 36, height: 36, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "white", cursor: "pointer", fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                        <input type="number" onWheel={e=>e.target.blur()} min="1" value={item.qty} onChange={e => setCart(prev => prev.map((it,j) => j===i ? {...it, qty: Math.max(1, +e.target.value)} : it))} style={{ width: 48, height: 36, textAlign: "center", border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "3px 0", fontWeight: 700, fontSize: 15 }} />
                        <button onClick={() => setCart(prev => prev.map((it,j) => j===i ? {...it, qty: it.qty+1} : it))} style={{ width: 36, height: 36, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "white", cursor: "pointer", fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                      </div>
                    </td>
                    <td>
                      <div>
                        <input type="number" onWheel={e=>e.target.blur()} value={item.price} onChange={e => setCart(prev => prev.map((it,j) => j===i ? {...it, price: +e.target.value} : it))} style={{ width: 70, border: "1.5px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontWeight: 600 }} />
                        {/* MRP per piece info */}
                        {item.mrpPerPiece > 0 && (
                          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, textDecoration: "line-through" }}>
                            MRP ₹{item.mrpPerPiece}/pc{item.piecesPerBox > 1 ? ` (box ₹${item.mrp}÷${item.piecesPerBox})` : ""}
                          </div>
                        )}
                        {item.mrpPerPiece > 0 && item.price < item.mrpPerPiece && (
                          <div style={{ fontSize: 10, color: "#059669", fontWeight: 700 }}>
                            saves ₹{item.mrpPerPiece - item.price}/pc
                          </div>
                        )}
                        {item.qty > 1 && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>×{item.qty} = ₹{(item.price * item.qty).toLocaleString()}</div>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {/* ₹ / % / =Price toggle */}
                        <div style={{ display:"flex", gap:2, marginBottom:2 }}>
                          {["₹","%","=₹"].map(t => (
                            <button key={t}
                              onClick={() => setCart(prev => prev.map((it,j) => j===i ? {...it, itemDiscountType:t, itemDiscount:0} : it))}
                              style={{ flex:1, padding:"2px 0", fontSize:10, fontWeight:700, border:"1px solid #e5e7eb", borderRadius:4, cursor:"pointer",
                                background: (item.itemDiscountType||"₹")===t ? (t==="=₹" ? "#7c3aed" : "#059669") : "white",
                                color: (item.itemDiscountType||"₹")===t ? "white" : "#9ca3af" }}
                              title={t==="=₹" ? "Final price daalo — discount auto calculate hoga" : t==="%" ? "Percentage discount" : "Rupee discount"}
                            >{t==="=₹" ? "= ₹" : t}</button>
                          ))}
                        </div>

                        {/* Input — changes based on mode */}
                        {(item.itemDiscountType||"₹") === "=₹" ? (
                          // TARGET PRICE MODE
                          <div>
                            <input
                              type="number" onWheel={e=>e.target.blur()} min="0"
                              value={item.itemDiscount || ""}
                              onChange={e => setCart(prev => prev.map((it,j) => j===i ? {...it, itemDiscount:+e.target.value||0} : it))}
                              placeholder={`max ₹${item.price * item.qty}`}
                              style={{ width:72, border:`1.5px solid ${item.itemDiscount > 0 && item.itemDiscount < item.price*item.qty ? "#a78bfa" : "#e5e7eb"}`, borderRadius:6, padding:"4px 8px", fontWeight:600, color:"#7c3aed", background: item.itemDiscount > 0 ? "#f5f3ff" : "white" }}
                            />
                            {/* Show what discount that means */}
                            {item.itemDiscount > 0 && item.itemDiscount < item.price * item.qty && (() => {
                              const targetTotal = +item.itemDiscount;
                              const originalTotal = item.price * item.qty;
                              const discRs = originalTotal - targetTotal;
                              const discPct = Math.round((discRs / originalTotal) * 100);
                              return (
                                <div style={{ marginTop: 3 }}>
                                  <div style={{ fontSize:9, color:"#7c3aed", fontWeight:700 }}>−₹{discRs} off ({discPct}%)</div>
                                  {item.qty > 1 && <div style={{ fontSize:9, color:"#9ca3af" }}>₹{Math.round(targetTotal/item.qty)}/pc final</div>}
                                </div>
                              );
                            })()}
                            {item.itemDiscount >= item.price * item.qty && item.itemDiscount > 0 && (
                              <div style={{ fontSize:9, color:"#ef4444", fontWeight:700 }}>Original se zyada!</div>
                            )}
                          </div>
                        ) : (
                          // ₹ or % mode
                          <div>
                            <input
                              type="number" onWheel={e=>e.target.blur()} min="0"
                              max={(item.itemDiscountType||"₹")==="%" ? 100 : undefined}
                              value={item.itemDiscount || ""}
                              onChange={e => setCart(prev => prev.map((it,j) => j===i ? {...it, itemDiscount:+e.target.value||0} : it))}
                              placeholder="0"
                              style={{ width:72, border:`1.5px solid ${resolveItemDisc(item)>0?"#86efac":"#e5e7eb"}`, borderRadius:6, padding:"4px 8px", fontWeight:600, color:"#059669", background: resolveItemDisc(item)>0?"#f0fdf4":"white" }}
                            />
                            {resolveItemDisc(item) > 0 && (
                              <div style={{ marginTop: 3 }}>
                                <span style={{ fontSize:9, color:"#059669", fontWeight:700 }}>−₹{resolveItemDisc(item)} off</span>
                                {item.qty > 1 && <span style={{ fontSize:9, color:"#9ca3af" }}> (₹{Math.round(resolveItemDisc(item)/item.qty)}/pc)</span>}
                              </div>
                            )}
                          </div>
                        )}
                        {resolveItemDisc(item) === 0 && (item.itemDiscountType||"₹") !== "=₹" && <span style={{ fontSize:9, color:"#d1d5db" }}>optional</span>}
                      </div>
                    </td>
                    <td style={{ fontWeight: 700, minWidth: 90 }}>
                      <div style={{ color: "#059669", fontSize: 15 }}>₹{finalNet.toLocaleString()}</div>
                      {/* Total MRP savings breakdown */}
                      {item.mrpPerPiece > 0 && (
                        <div style={{ fontSize: 10, color: "#9ca3af", textDecoration: "line-through" }}>MRP ₹{(item.mrpPerPiece * item.qty).toLocaleString()}</div>
                      )}
                      {(item.mrpPerPiece > 0 || hasItemDisc || billDiscPreview > 0) && (
                        <div style={{ fontSize: 9, color: "#059669", fontWeight: 700 }}>
                          saves ₹{((item.mrpPerPiece > 0 ? (item.mrpPerPiece - item.price) * item.qty : 0) + resolveItemDisc(item) + billDiscPreview).toLocaleString()}
                        </div>
                      )}
                      {hasItemDisc && <div style={{ fontSize: 9, color: "#059669" }}>after item disc</div>}
                      {billDiscPreview > 0 && !hasItemDisc && (
                        <div style={{ fontSize: 9, color: "#7c3aed" }}>incl. −₹{billDiscPreview} bill disc</div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {/* BUG3 FIX: Price Fix toggle button */}
                        <button
                          title={item.priceFixed ? "Price unfix karo — discounts lagenge" : "Price fix karo — koi discount nahi lagega"}
                          onClick={() => setCart(prev => prev.map((it,j) => j===i ? {...it, priceFixed: !it.priceFixed} : it))}
                          style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${item.priceFixed ? "#fcd34d" : "#e5e7eb"}`, background: item.priceFixed ? "#fef3c7" : "white", cursor: "pointer", fontSize: 13, fontWeight: 700, color: item.priceFixed ? "#b45309" : "#9ca3af" }}
                        >{item.priceFixed ? "🔒" : "🔓"}</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setCart(cart.filter((_, j) => j !== i))} style={{ padding: "8px 12px", fontSize: 15 }}><Icon name="trash" size={16} /></button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {cart.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "#9ca3af", padding: 36, fontSize: 14 }}>Cart khali hai. Upar se product add karo.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right: Bill Summary */}
      <div style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Customer */}
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>👤 Customer (Optional)</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Phone search — search by phone or name, autofill */}
            <div style={{ position: "relative" }}>
              <input className="input" value={customerPhone}
                onChange={e => {
                  setCustomerPhone(e.target.value);
                  const found = customers.find(c => c.phone === e.target.value);
                  if (found) { setCustomerName(found.name); setCustomerRegion(found.region || ""); }
                }}
                placeholder="📞 Phone number daalo (autofill hoga)" />
              {customerPhone && customers.find(c => c.phone === customerPhone) && (
                <div style={{ fontSize:10, color:"#059669", fontWeight:700, marginTop:2, padding:"2px 4px" }}>
                  ✓ {customers.find(c => c.phone === customerPhone)?.name} — {getCustomerSales(customerPhone).length} visits, ₹{getCustomerSales(customerPhone).reduce((a,s)=>a+(getCurrentVersion(s).total||0),0).toLocaleString()} total
                </div>
              )}
            </div>
            {/* Name — with dropdown suggestions */}
            <div style={{ position:"relative" }}>
              <input className="input" value={customerName}
                onChange={e => {
                  setCustomerName(e.target.value);
                  setShowCustDrop(true);
                }}
                onFocus={() => setShowCustDrop(true)}
                onBlur={() => setTimeout(() => setShowCustDrop(false), 180)}
                placeholder="Customer naam" />
              {showCustDrop && customerName && (() => {
                const matches = customers.filter(c =>
                  c.name?.toLowerCase().includes(customerName.toLowerCase()) ||
                  c.phone?.includes(customerName)
                ).slice(0, 5);
                if (!matches.length) return null;
                return (
                  <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"white", border:"1.5px solid #e5e7eb", borderRadius:10, zIndex:200, boxShadow:"0 8px 20px rgba(0,0,0,0.1)", marginTop:3 }}>
                    {matches.map(c => (
                      <div key={c.id} onMouseDown={() => {
                        setCustomerName(c.name);
                        setCustomerPhone(c.phone);
                        setCustomerRegion(c.region || "");
                        setShowCustDrop(false);
                      }} style={{ padding:"8px 12px", cursor:"pointer", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontWeight:700, fontSize:12.5 }}>{c.name}</div>
                          <div style={{ fontSize:11, color:"#9ca3af" }}>{c.phone}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:10, color:"#7c3aed", fontWeight:700 }}>{getCustomerSales(c.phone).length} visits</div>
                          <div style={{ fontSize:10, color:"#9ca3af" }}>{c.region==="local"?"🏠":c.region==="out-city"?"🌆":c.region==="out-state"?"✈️":"—"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {/* Region */}
            <div>
              <label className="label" style={{ fontSize:11 }}>📍 Region (optional)</label>
              <div style={{ display:"flex", gap:4 }}>
                {[{v:"", l:"Any"}, {v:"local", l:"🏠 Local"}, {v:"out-city", l:"🌆 Out City"}, {v:"out-state", l:"✈️ Out State"}].map(r => (
                  <button key={r.v} onClick={() => setCustomerRegion(r.v)}
                    style={{ padding:"4px 10px", fontSize:11, border:`1.5px solid ${customerRegion===r.v?"#7c3aed":"#e5e7eb"}`, borderRadius:7, background: customerRegion===r.v?"#f5f3ff":"white", color: customerRegion===r.v?"#7c3aed":"#6b7280", fontWeight: customerRegion===r.v?700:400, cursor:"pointer" }}>
                    {r.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Discount + Tax */}
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🏷️ Discount & Tax</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label className="label">Discount</label>
              <div style={{ display: "flex", gap: 6 }}>
                {/* Toggle ₹ / % */}
                <div style={{ display: "flex", borderRadius: 10, border: "1.5px solid #e5e7eb", overflow: "hidden", flexShrink: 0 }}>
                  {["₹", "%"].map(t => (
                    <button key={t} onClick={() => { setDiscountType(t); setDiscountVal(""); }} style={{ padding: "8px 14px", border: "none", background: discountType === t ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "white", color: discountType === t ? "white" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 14, transition: "all 0.2s" }}>{t}</button>
                  ))}
                </div>
                <input className="input" type="number" onWheel={e=>e.target.blur()} value={discountVal} onChange={e => setDiscountVal(e.target.value)} placeholder={discountType === "%" ? "e.g. 10" : "e.g. 50"} />
              </div>
              {discountVal && subtotalEligibleForBillDisc > 0 && (
                <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600, marginTop: 4 }}>
                  = ₹{discountType === "%" ? Math.round(subtotalEligibleForBillDisc * (+discountVal / 100)) : Math.min(+discountVal, subtotalEligibleForBillDisc)} bill discount
                  {itemDiscountTotal > 0 && <span style={{ color: "#9ca3af", fontWeight: 400 }}> (item-disc wale items pe nahi lagega)</span>}
                </div>
              )}
            </div>
            <div>
              <label className="label">GST % (Optional)</label>
              <input className="input" type="number" onWheel={e=>e.target.blur()} value={tax} onChange={e => setTax(e.target.value)} placeholder="e.g. 5 ya 18" />
            </div>
          </div>
        </div>

        {/* Bill Summary */}
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🧾 Bill Summary</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 12 }}>

            {/* Step 1: MRP Total + per-item MRP savings */}
            {mrpDiscountTotal > 0 && (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#9ca3af" }}>
                  <span>MRP Total ({cart.reduce((a,b)=>a+b.qty,0)} items)</span>
                  <span style={{ textDecoration:"line-through" }}>₹{mrpTotal.toLocaleString()}</span>
                </div>
                {cart.filter(it => itemMRPDisc(it) > 0).map((it, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#d97706", paddingLeft:10 }}>
                    <span>↳ {it.name}{it.sku?` [${it.sku}]`:""} {it.size&&it.size!=="-"?`(${it.size})`:""} ×{it.qty}</span>
                    <span style={{ fontWeight:700 }}>−₹{itemMRPDisc(it).toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#d97706", fontWeight:700 }}>
                  <span>🏷️ MRP se sasta</span>
                  <span>−₹{mrpDiscountTotal.toLocaleString()}</span>
                </div>
                <div style={{ borderTop:"1px dashed #e5e7eb" }} />
              </>
            )}

            {/* Step 2: Our Rate Subtotal */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "#374151", fontWeight:600 }}>
              <span>Subtotal (Hamara rate)</span>
              <span style={{ color: "#1f2937" }}>₹{subtotal.toLocaleString()}</span>
            </div>

            {/* Step 3: Item-wise discounts */}
            {itemDiscountTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#059669" }}>
                <span>🏷️ Item Discount ({itemsWithItemDisc.length} item{itemsWithItemDisc.length!==1?"s":""})</span>
                <span style={{ fontWeight: 700 }}>−₹{itemDiscountTotal.toLocaleString()}</span>
              </div>
            )}

            {/* Step 4: Bill-level discount */}
            {discountAmt > 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#7c3aed" }}>
                  <span>Bill Discount ({discountType === "%" ? `${discountVal}%` : `₹${discountVal}`}){itemsWithItemDisc.length > 0 ? ` · ${itemsWithoutItemDisc.length} items pe` : ""}</span>
                  <span style={{ fontWeight: 700 }}>−₹{discountAmt.toLocaleString()}</span>
                </div>
                {itemsWithItemDisc.length > 0 && (
                  <div style={{ fontSize: 10, color: "#9ca3af", background: "#f5f3ff", padding: "3px 10px", borderRadius: 6 }}>
                    ℹ️ Item-disc wale {itemsWithItemDisc.length} item{itemsWithItemDisc.length!==1?"s":""} pe bill discount nahi laga
                  </div>
                )}
              </>
            )}

            {/* GST */}
            {taxAmt > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#d97706" }}>
                <span>GST ({tax}%)</span><span>+₹{taxAmt.toLocaleString()}</span>
              </div>
            )}

            {/* Bill Total */}
            <div style={{ borderTop: "2px solid #f3f4f6", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1f2937" }}>Bill Total</span>
              <span style={{ fontSize: 17, fontWeight: 800, color: "#7c3aed" }}>₹{afterDiscountTax.toLocaleString()}</span>
            </div>
          </div>

          {/* ── Received Amount ── */}
          <div style={{ background: "#f5f3ff", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <label className="label" style={{ color: "#7c3aed" }}>💰 Received Amount <span style={{ fontWeight:400, color:"#9ca3af" }}>(customer ne diya)</span></label>
            <input
              className="input"
              type="number" onWheel={e=>e.target.blur()}
              value={receivedAmt}
              onChange={e => setReceivedAmt(e.target.value)}
              placeholder={`₹${afterDiscountTax.toLocaleString()} (full amount)`}
              style={{ marginTop: 6, borderColor: "#a855f7" }}
            />
            {received !== null && received > afterDiscountTax && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>
                ⚠️ Received amount bill se zyada hai
              </div>
            )}
          </div>

          {/* ── Discount Breakdown — only when any discount ── */}
          {(() => {
            const mrpItems = cart.filter(it => it.mrpPerPiece > 0 && it.mrpPerPiece > it.price);
            const mrpSavingsTotal = mrpItems.reduce((a, it) => a + (it.mrpPerPiece - it.price) * it.qty, 0);
            // extraDiscount (customer ne kam diya) = uski bachat bhi hai
            const hasAnyDiscount = itemDiscountTotal > 0 || discountAmt > 0 || mrpSavingsTotal > 0 || extraDiscount > 0;
            if (!hasAnyDiscount) return null;
            // totalAllSavings = actual discounts + extraDiscount (settled amount)
            const totalAllSavings = mrpSavingsTotal + itemDiscountTotal + discountAmt + extraDiscount;
            return (
              <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>💰 Customer ki Total Savings</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {/* Per-item breakdown */}
                  {cart.map((it, i) => {
                    const mrpSav = it.mrpPerPiece > it.price ? (it.mrpPerPiece - it.price) * it.qty : 0;
                    const discSav = resolveItemDisc(it);
                    const itTotal = mrpSav + discSav;
                    if (itTotal <= 0) return null;
                    return (
                      <div key={i} style={{ paddingBottom:4, marginBottom:4, borderBottom:"1px dashed #bbf7d0" }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{it.name} {it.size&&it.size!=="-"?`(${it.size})`:""} ×{it.qty}</div>
                        {mrpSav > 0 && (
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#d97706", paddingLeft:8 }}>
                            <span>MRP se sasta</span><span>−₹{mrpSav}</span>
                          </div>
                        )}
                        {discSav > 0 && (
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#059669", paddingLeft:8 }}>
                            <span>Item discount</span><span>−₹{discSav}</span>
                          </div>
                        )}
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11.5, fontWeight:700, color:"#15803d", paddingLeft:8 }}>
                          <span>Subtotal saving</span><span>−₹{itTotal}</span>
                        </div>
                      </div>
                    );
                  })}
                  {discountAmt > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#374151" }}>
                      <span>Bill discount</span>
                      <span style={{ fontWeight: 700, color: "#7c3aed" }}>−₹{discountAmt.toLocaleString()}</span>
                    </div>
                  )}
                  {extraDiscount > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#374151" }}>
                      <span>Less kiya (extra bachat)</span>
                      <span style={{ fontWeight: 700, color: "#15803d" }}>−₹{extraDiscount.toLocaleString()}</span>
                    </div>
                  )}
                  <div style={{ borderTop: "1.5px dashed #86efac", paddingTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#15803d" }}>Total Bachaya</span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: "#15803d" }}>−₹{totalAllSavings.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Final Amount ── */}
          <div style={{ background: "#ecfdf5", border: "2px solid #6ee7b7", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: received !== null && received < afterDiscountTax ? 6 : 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#1f2937" }}>✅ Final Amount</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: "#059669" }}>₹{finalTotal.toLocaleString()}</span>
            </div>
            {received !== null && received < afterDiscountTax && (
              <div style={{ fontSize: 12, color: "#047857", borderTop: "1px dashed #6ee7b7", paddingTop: 6, marginTop: 2 }}>
                Bill ₹{afterDiscountTax} था → Customer ne ₹{received} diya → Extra discount ₹{extraDiscount}
              </div>
            )}
          </div>

          {/* BUG29 FIX: disabled + spinner when sale in progress */}
          <button className="btn btn-success" style={{ width: "100%", justifyContent: "center", padding: "14px", fontSize: 15, opacity: saleInProgress ? 0.6 : 1, cursor: saleInProgress ? "not-allowed" : "pointer" }} onClick={completeSale} disabled={saleInProgress}>
            {saleInProgress ? "⏳ Processing..." : <><Icon name="check" size={18} /> Bill Complete Karo</>}
          </button>
        </div>
      </div>


      {/* ── Settlement Modal — Customer ne kam diya ── */}
      {showSettleModal && (() => {
        const remaining = extraDiscount - totalSettled;
        const isDone = Math.abs(remaining) < 1;

        return (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>
              {/* Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:16, fontWeight:800, color:"#111827" }}>💰 Bill Settlement</h3>
                  <p style={{ fontSize:12, color:"#9ca3af", marginTop:2 }}>
                    Customer ne <b style={{color:"#d97706"}}>₹{extraDiscount}</b> kam diye — har item mein manually settle karo
                  </p>
                </div>
                <button onClick={()=>setShowSettleModal(false)} style={{ background:"#f3f4f6", border:"none", borderRadius:8, width:30, height:30, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Icon name="close" size={15} />
                </button>
              </div>

              {/* Remaining pill — always on top */}
              <div style={{ background: isDone?"#f0fdf4":remaining<0?"#fef2f2":"#fef3c7", border:`1.5px solid ${isDone?"#86efac":remaining<0?"#fecaca":"#fcd34d"}`, borderRadius:12, padding:"10px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:700, color: isDone?"#15803d":remaining<0?"#dc2626":"#92400e" }}>
                  {isDone ? "✅ Sab settle ho gaya!" : remaining < 0 ? `⚠️ ₹${Math.abs(remaining)} zyada ho gaya!` : `Abhi ₹${remaining} aur settle karna hai`}
                </span>
                <span style={{ fontSize:20, fontWeight:900, color: isDone?"#059669":remaining<0?"#dc2626":"#d97706" }}>
                  {isDone ? "✓" : `₹${Math.abs(remaining)}`}
                </span>
              </div>

              {/* Per-item rows */}
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
                {cart.map((item) => {
                  const mrp = itemMRP(item);
                  const iDisc = resolveItemDisc(item);
                  const billD = iDisc > 0 ? 0 : (subtotalEligibleForBillDisc > 0 ? Math.round(mrp * discountAmt / subtotalEligibleForBillDisc) : 0);
                  const afterDisc = Math.max(0, mrp - iDisc - billD);
                  const mySettle = settleAmounts[item.cartItemId] || 0;
                  const finalPay = afterDisc - mySettle;
                  return (
                    <div key={item.cartItemId} style={{ background:"white", border:`1.5px solid ${mySettle>0?"#fcd34d":"#e5e7eb"}`, borderRadius:10, padding:"10px 14px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: mySettle>0?6:0 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:13 }}>{item.name}
                            {item.size!=="-" && <span style={{ fontSize:10, color:"#9ca3af", marginLeft:5 }}>{item.size}</span>}
                            {item.qty>1 && <span style={{ fontSize:10, color:"#9ca3af", marginLeft:4 }}>×{item.qty}</span>}
                          </div>
                          <div style={{ fontSize:11, color:"#9ca3af" }}>
                            ₹{item.price}{item.qty>1?` × ${item.qty}`:""}
                            {(iDisc>0||billD>0) && ` → ₹${afterDisc} after disc`}
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ textAlign:"right", minWidth:60 }}>
                            <div style={{ fontSize:10, color:"#6b7280", marginBottom:2 }}>Less karo ₹</div>
                            <input
                              type="number" onWheel={e=>e.target.blur()} min="0" max={afterDisc}
                              value={mySettle || ""}
                              onChange={e => {
                                const v = Math.max(0, Math.min(+e.target.value || 0, afterDisc));
                                setSettleAmounts(prev => ({ ...prev, [item.cartItemId]: v }));
                              }}
                              placeholder="0"
                              style={{ width:72, border:`1.5px solid ${mySettle>0?"#fcd34d":"#e5e7eb"}`, borderRadius:7, padding:"5px 8px", fontWeight:700, fontSize:14, textAlign:"right", background: mySettle>0?"#fffbeb":"white" }}
                            />
                          </div>
                        </div>
                      </div>
                      {mySettle > 0 && (
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginTop:4, padding:"4px 8px", background:"#fffbeb", borderRadius:6 }}>
                          <span style={{ color:"#92400e" }}>₹{afterDisc} − ₹{mySettle} less</span>
                          <span style={{ fontWeight:800, color:"#059669" }}>= ₹{finalPay} customer dega</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={finalizeSale} disabled={!isDone}
                  className="btn btn-success"
                  style={{ flex:2, justifyContent:"center", opacity: isDone?1:0.45 }}>
                  <Icon name="check" size={16} /> Bill Complete Karo
                </button>
                <button onClick={() => {
                  // Auto divide proportionally across all items
                  const totalAfter = cart.reduce((a, it) => {
                    const m = itemMRP(it), id = resolveItemDisc(it);
                    const bd = id>0?0:(subtotalEligibleForBillDisc>0?Math.round(m*discountAmt/subtotalEligibleForBillDisc):0);
                    return a + Math.max(0, m-id-bd);
                  }, 0);
                  const newSettle = {}; let left = extraDiscount;
                  cart.forEach((it, idx) => {
                    const m = itemMRP(it), id = resolveItemDisc(it);
                    const bd = id>0?0:(subtotalEligibleForBillDisc>0?Math.round(m*discountAmt/subtotalEligibleForBillDisc):0);
                    const eff = Math.max(0, m-id-bd);
                    const share = idx===cart.length-1 ? left : Math.round(extraDiscount * eff / Math.max(1, totalAfter));
                    newSettle[it.cartItemId] = Math.min(share, eff);
                    left -= newSettle[it.cartItemId];
                  });
                  setSettleAmounts(newSettle);
                }} className="btn btn-outline" style={{ flex:1, justifyContent:"center", fontSize:11 }}>
                  Auto Divide
                </button>
              </div>
              <p style={{ fontSize:10, color:"#9ca3af", marginTop:6, textAlign:"center" }}>
                "Auto Divide" — ₹{extraDiscount} sabhi items par proportion mein divide kar dega
              </p>
            </div>
          </div>
        );
      })()}

      {/* Invoice Modal */}
      {showInvoice && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, background: "#d1fae5", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", color: "#059669" }}><Icon name="check" size={28} /></div>
              <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700 }}>Sale Complete! 🎉</h3>
              <p style={{ color: "#9ca3af", fontSize: 13 }}>{showInvoice.billNo} • {showInvoice.date}</p>
            </div>
            {/* ── Invoice Items + Summary — MRP-first transparent design ── */}
            <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, color: "#1f2937" }}>{shopName}</div>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
                {showInvoice.phone && customers.find(c => c.phone === showInvoice.phone) ? (
                  <span
                    onClick={() => {
                      setShowInvoice(null);
                      if (setHighlightPhone) setHighlightPhone(showInvoice.phone);
                      if (setActiveTab) setActiveTab("customers");
                    }}
                    style={{ color: "#7c3aed", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                    title="Customer profile kholne ke liye click karo"
                  >
                    👤 {showInvoice.customer}
                  </span>
                ) : (
                  <span>Customer: {showInvoice.customer}</span>
                )}
                {showInvoice.phone ? ` • ${showInvoice.phone}` : ""}
              </p>

              {/* Item rows */}
              {showInvoice.items.map((item, i) => {
                const mrpPc = item.mrpPerPiece || 0;
                const qty = item.qty || 1;
                const ratePc = item.price;
                const rateTotal = ratePc * qty;
                const mrpSaving = mrpPc > ratePc ? (mrpPc - ratePc) * qty : 0;
                const iDiscRs = item.itemDiscountRs || 0;
                const settled = item.settledDisc || 0;
                const effTotal = item.effectiveTotal !== undefined ? item.effectiveTotal : (rateTotal - iDiscRs - settled);
                const billDiscOnItem = Math.max(0, Math.round(rateTotal - iDiscRs - settled - effTotal));
                const hasAnyDisc = mrpSaving > 0 || iDiscRs > 0 || billDiscOnItem > 0 || settled > 0;
                const mrpLineTotal = mrpPc > 0 ? mrpPc * qty : rateTotal;

                return (
                  <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: hasAnyDisc ? 4 : 0 }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5, color: "#1f2937" }}>{item.name}</span>
                        {item.sku && <span style={{ fontSize: 10.5, color: "#7c3aed", fontWeight: 700, background: "#f5f3ff", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>{item.sku}</span>}
                        {qty > 1 && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>×{qty}</span>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {hasAnyDisc
                          ? <span style={{ fontSize: 11, color: "#9ca3af", textDecoration: "line-through" }}>₹{mrpLineTotal.toLocaleString()}</span>
                          : <span style={{ fontWeight: 800, fontSize: 14, color: "#1f2937" }}>₹{rateTotal.toLocaleString()}</span>
                        }
                      </div>
                    </div>
                    {hasAnyDisc && (
                      <div style={{ paddingLeft: 4 }}>
                        {mrpSaving > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#d97706", marginBottom: 1 }}>
                            <span>MRP Discount</span><span style={{ fontWeight: 700 }}>−₹{mrpSaving}</span>
                          </div>
                        )}
                        {iDiscRs > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#059669", marginBottom: 1 }}>
                            <span>Item Discount</span><span style={{ fontWeight: 700 }}>−₹{iDiscRs}</span>
                          </div>
                        )}
                        {billDiscOnItem > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#7c3aed", marginBottom: 1 }}>
                            <span>Bill Discount</span><span style={{ fontWeight: 700 }}>−₹{billDiscOnItem}</span>
                          </div>
                        )}
                        {settled > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#f59e0b", marginBottom: 1 }}>
                            <span>Less kiya</span><span style={{ fontWeight: 700 }}>−₹{settled}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, color: "#059669", marginTop: 3, paddingTop: 3, borderTop: "1px dashed #e5e7eb" }}>
                          <span>Total</span><span>₹{effTotal.toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}              

              {/* ── Bill Summary ── */}
              {(() => {
                const s = calcBillSummary(showInvoice);
                const mrpTotal = s.mrpSubtotal > 0 ? s.mrpSubtotal : showInvoice.total;
                const totalDiscount = s.mrpDiscount + s.itemDiscTotal + s.billDiscAmt + s.legacyDisc + s.settledTotal;
                return (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "2px solid #e5e7eb" }}>
                    {/* MRP Total */}
                    {s.mrpSubtotal > showInvoice.total && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#9ca3af", marginBottom: 4 }}>
                        <span>MRP Total ({showInvoice.items?.reduce((a,b)=>a+(b.qty||1),0)} pcs)</span>
                        <span style={{ textDecoration: "line-through" }}>₹{s.mrpSubtotal.toLocaleString()}</span>
                      </div>
                    )}
                    {/* Total Discount */}
                    {totalDiscount > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#059669", fontWeight: 700, marginBottom: 4 }}>
                        <span>Total Discount</span>
                        <span>−₹{totalDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    {/* BUG5 FIX: Bill Total (before partial payment) */}
                    {s.received < s.total && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
                        <span>Bill Total</span>
                        <span>₹{s.total.toLocaleString()}</span>
                      </div>
                    )}
                    {/* BUG5 FIX: Show actual received / amount collected */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 20, color: "#1f2937", marginTop: 8, paddingTop: 8, borderTop: "2px solid #e5e7eb" }}>
                      <span>TOTAL PAID</span>
                      {/* BUG5 FIX: use received amount, not bill total */}
                      <span style={{ color: "#7c3aed" }}>₹{(s.received ?? s.total).toLocaleString()}</span>
                    </div>
                    {/* Show balance if partial payment */}
                    {s.received < s.total && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#f59e0b", fontWeight: 700, marginTop: 4 }}>
                        <span>⚠️ Balance Baki</span>
                        <span>₹{(s.total - s.received).toLocaleString()}</span>
                      </div>
                    )}
                    {/* You Saved badge — totalSavings ab settled bhi include karta hai */}
                    {s.totalSavings > 0 ? (
                        <div style={{ marginTop: 10, background: "linear-gradient(135deg,#ecfdf5,#d1fae5)", border: "1.5px solid #6ee7b7", borderRadius: 10, padding: "8px 14px", textAlign: "center" }}>
                          <span style={{ fontSize: 13.5, fontWeight: 800, color: "#065f46" }}>
                            🎉 You Saved: ₹{s.totalSavings.toLocaleString()}
                          </span>
                        </div>
                      ) : null}
                  </div>
                );
              })()}
            </div>
            <BillActions bill={showInvoice} shopName={shopName} onClose={() => setShowInvoice(null)} showNewBill={true} />
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// PURCHASES
// ============================================================
const Purchases = ({ purchases, setPurchases, products, setProducts, showToast }) => {
  const [showModal, setShowModal] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const [showCodeDropdown, setShowCodeDropdown] = useState(false);
  const [matchedProduct, setMatchedProduct] = useState(null); // existing product from inventory
  const [form, setForm] = useState({
    supplier: "",
    productId: "",
    productCode: "",
    productName: "",
    category: "",
    purchasePrice: "",
    sellingPrice: "",
    quantity: "",
    date: new Date().toISOString(),
    mrp: "",
    updateInventoryPrice: false,
  });

  const resetForm = () => {
    setForm({ supplier: "", productId: "", productCode: "", productName: "", category: "", purchasePrice: "", mrp: "", sellingPrice: "", quantity: "", date: new Date().toISOString(), updateInventoryPrice: false });
    setMatchedProduct(null);
    setCodeSearch("");
  };

  // Search products by code or name
  const codeFiltered = products.filter(p =>
    (p.sku || "").toLowerCase().includes(codeSearch.toLowerCase()) ||
    p.name.toLowerCase().includes(codeSearch.toLowerCase())
  );

  // When user selects a product from search
  const selectExistingProduct = (p) => {
    setMatchedProduct(p);
    setCodeSearch(p.sku || p.name);
    setShowCodeDropdown(false);
    setForm(f => ({
      ...f,
      productId: p.id,
      productCode: p.sku || "",
      productName: p.name,
      category: p.category || "",
      purchasePrice: p.purchasePrice || "",
      sellingPrice: p.sellingPrice || "",
    }));
  };

  // When user types code manually (no match) — new product
  const handleCodeInput = (val) => {
    setCodeSearch(val);
    setShowCodeDropdown(true);
    // If user clears, also clear matched
    if (!val) { setMatchedProduct(null); setForm(f => ({ ...f, productId: "", productCode: "", productName: "", category: "", purchasePrice: "", sellingPrice: "" })); }
    else setForm(f => ({ ...f, productCode: val }));
  };

  const save = () => {
    if (!form.supplier || !form.productName || !form.quantity || !form.purchasePrice) {
      showToast("Supplier, Product naam, Quantity aur Purchase Price zaroori hai", "error"); return;
    }
    const qty = +form.quantity;
    const purPrice = +form.purchasePrice;
    const sellPrice = +form.sellingPrice;

    const purchase = {
      id: Date.now(),
      supplier: form.supplier,
      productId: form.productId || null,
      productCode: form.productCode,
      product: form.productName,
      category: form.category,
      quantity: qty,
      purchasePrice: purPrice,
      mrp: form.mrp ? +form.mrp : null,
      sellingPrice: sellPrice || null,
      date: form.date,
      total: qty * purPrice,
    };
    setPurchases([...purchases, purchase]);

    // Update inventory with price history
    if (form.productId) {
      setProducts(prev => prev.map(p => {
        if (p.id !== +form.productId) return p;
        const priceEntry = {
          date: form.date,
          purchasePrice: purPrice,
          mrp: form.mrp ? +form.mrp : (p.mrp || null),
          supplier: form.supplier,
          qty,
        };
        const existingHistory = p.priceHistory || [];
        const updated = {
          ...p,
          quantity: p.quantity + qty,
          priceHistory: [...existingHistory, priceEntry],
        };
        if (form.updateInventoryPrice) {
          if (purPrice) updated.purchasePrice = purPrice;
          if (sellPrice) updated.sellingPrice = sellPrice;
          if (form.mrp) updated.mrp = +form.mrp;
        }
        return updated;
      }));
      showToast(`✅ Stock updated! ${form.productName} mein +${qty} add hua`);
    } else {
      showToast("✅ Purchase recorded (naya product — inventory se link nahi hai)");
    }

    setShowModal(false);
    resetForm();
  };

  const totalSpent = purchases.reduce((a, b) => a + b.total, 0);
  const totalQty = purchases.reduce((a, b) => a + b.quantity, 0);

  return (
    <div className="page">
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Kul Purchases", value: purchases.length, color: "#7c3aed", icon: "📦" },
          { label: "Kul Spend", value: `₹${totalSpent.toLocaleString()}`, color: "#dc2626", icon: "💸" },
          { label: "Items Khareed", value: totalQty, color: "#2563eb", icon: "👕" },
          { label: "Suppliers", value: [...new Set(purchases.map(p => p.supplier))].length, color: "#059669", icon: "🏭" },
        ].map((s, i) => (
          <div key={i} className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
            <p style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>{s.label}</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
          <Icon name="plus" size={16} /> Naya Purchase Add Karo
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-scroll-wrap" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table className="table">
            <thead><tr>
              <th>Date</th><th>Supplier</th><th>Code</th><th>Product</th><th>Qty</th>
              <th>Purchase ₹</th><th>Selling ₹</th><th>Total Cost</th>
            </tr></thead>
            <tbody>
              {[...purchases].sort((a,b) => (b.date||"").localeCompare(a.date||"")||b.id-a.id).map(p => (
                <tr key={p.id}>
                  <td style={{ color: "#6b7280", whiteSpace: "nowrap", fontSize: 11 }}>
                    {(() => { try { const d = new Date(p.date); return isNaN(d) ? p.date : <><div>{d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</div><div style={{fontSize:10,color:"#9ca3af"}}>{d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div></>; } catch { return p.date; }})()}
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.supplier}</td>
                  <td>
                    {p.productCode
                      ? <span style={{ background: "#f5f3ff", color: "#7c3aed", fontWeight: 700, fontSize: 12, padding: "2px 8px", borderRadius: 6, letterSpacing: 1 }}>{p.productCode.toUpperCase()}</span>
                      : <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.product}</div>
                    {p.category && <div style={{ fontSize: 11, color: "#9ca3af" }}>{p.category}</div>}
                  </td>
                  <td><span className="badge badge-blue">{p.quantity} pcs</span></td>
                  <td style={{ fontWeight: 600, color: "#dc2626" }}>₹{p.purchasePrice}</td>
                  <td style={{ fontWeight: 600, color: "#059669" }}>{p.sellingPrice ? `₹${p.sellingPrice}` : <span style={{ color: "#d1d5db" }}>—</span>}</td>
                  <td style={{ fontWeight: 800, color: "#1f2937" }}>₹{p.total.toLocaleString()}</td>
                </tr>
              ))}
              {purchases.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>
                  Koi purchase record nahi hai abhi
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 600 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>📦 Naya Purchase Record Karo</h3>
                <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Product code se search karo ya naya naam daalo</p>
              </div>
              <button onClick={() => { setShowModal(false); resetForm(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><Icon name="close" size={22} /></button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Step 1: Product Code Search */}
              <div style={{ background: "#f5f3ff", borderRadius: 14, padding: 16 }}>
                <label className="label" style={{ color: "#7c3aed" }}>🔍 Product Code ya Naam se Search Karo</label>
                <div style={{ position: "relative", marginTop: 6 }}>
                  <input
                    className="input"
                    value={codeSearch}
                    onChange={e => handleCodeInput(e.target.value)}
                    onFocus={() => codeSearch && setShowCodeDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCodeDropdown(false), 180)}
                    placeholder="Product code (e.g. ab, c) ya naam type karo..."
                    style={{ borderColor: matchedProduct ? "#7c3aed" : undefined, fontWeight: matchedProduct ? 700 : 400 }}
                  />
                  {showCodeDropdown && codeSearch && codeFiltered.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1.5px solid #e5e7eb", borderRadius: 12, zIndex: 300, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
                      {codeFiltered.map(p => (
                        <div key={p.id} onMouseDown={() => selectExistingProduct(p)}
                          style={{ padding: "11px 14px", cursor: "pointer", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</span>
                            <span style={{ marginLeft: 8, background: "#ede9fe", color: "#7c3aed", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 5 }}>{(p.sku || "").toUpperCase()}</span>
                            <span style={{ marginLeft: 6, fontSize: 12, color: "#9ca3af" }}>{p.category}</span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>Buy ₹{p.purchasePrice}</div>
                            <div style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>Sell ₹{p.sellingPrice}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Matched product info card */}
                {matchedProduct && (
                  <div style={{ marginTop: 10, background: "white", borderRadius: 10, padding: "10px 14px", border: "1.5px solid #c4b5fd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1f2937" }}>{matchedProduct.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{matchedProduct.category} • {matchedProduct.brand} • Stock: <b style={{ color: matchedProduct.quantity <= 5 ? "#e11d48" : "#059669" }}>{matchedProduct.quantity}</b></div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>Existing Purchase: ₹{matchedProduct.purchasePrice}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>Existing Selling: ₹{matchedProduct.sellingPrice}</div>
                    </div>
                  </div>
                )}
                {codeSearch && !matchedProduct && (
                  <p style={{ fontSize: 12, color: "#f59e0b", marginTop: 6, fontWeight: 600 }}>⚠️ Naya product — inventory se link nahi hoga</p>
                )}
              </div>

              {/* Supplier + Date */}
              <div className="form-row form-row-2">
                <div><label className="label">Supplier Naam *</label><input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="e.g. Mumbai Textiles" /></div>
                <div><label className="label">Date</label><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              </div>

              {/* Product details — editable even if existing */}
              <div className="form-row form-row-2">
                <div>
                  <label className="label">Product Naam *</label>
                  <input className="input" value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} placeholder="Product naam" />
                </div>
                <div>
                  <label className="label">Category</label>
                  <select className="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    <option value="">Select</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Prices + Qty */}
              <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label className="label">Purchase Price ₹ *</label>
                  <input className="input" type="number" onWheel={e=>e.target.blur()} value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} placeholder="450" />
                  {matchedProduct && +form.purchasePrice !== matchedProduct.purchasePrice && form.purchasePrice && (
                    <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 3, fontWeight: 600 }}>
                      Pehle: ₹{matchedProduct.purchasePrice} → Ab: ₹{form.purchasePrice}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">MRP ₹ <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                  <input className="input" type="number" onWheel={e=>e.target.blur()} value={form.mrp || ""} onChange={e => setForm({ ...form, mrp: e.target.value })} placeholder="e.g. 336" />
                  {matchedProduct && matchedProduct.mrp > 0 && (
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>Pehle: ₹{matchedProduct.mrp}</div>
                  )}
                </div>
                <div>
                  <label className="label">Selling Price ₹</label>
                  <input className="input" type="number" onWheel={e=>e.target.blur()} value={form.sellingPrice} onChange={e => setForm({ ...form, sellingPrice: e.target.value })} placeholder="899" />
                  {matchedProduct && +form.sellingPrice !== matchedProduct.sellingPrice && form.sellingPrice && (
                    <div style={{ fontSize: 11, color: "#059669", marginTop: 3, fontWeight: 600 }}>
                      Pehle: ₹{matchedProduct.sellingPrice} → Ab: ₹{form.sellingPrice}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">Quantity *</label>
                  <input className="input" type="number" onWheel={e=>e.target.blur()} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="50" />
                </div>
              </div>

              {/* Cost summary */}
              {form.quantity && form.purchasePrice && (
                <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>💰 Kul Purchase Cost</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#d97706" }}>₹{(+form.quantity * +form.purchasePrice).toLocaleString()}</div>
                </div>
              )}

              {/* Update inventory prices toggle — only for existing product */}
              {matchedProduct && (
                <div style={{ background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46" }}>📊 Inventory mein price update karo?</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Purchase/Selling price inventory mein bhi change ho jaayega</div>
                  </div>
                  <button
                    onClick={() => setForm(f => ({ ...f, updateInventoryPrice: !f.updateInventoryPrice }))}
                    style={{ width: 48, height: 26, borderRadius: 13, border: "none", background: form.updateInventoryPrice ? "#059669" : "#d1d5db", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}
                  >
                    <span style={{ position: "absolute", top: 3, left: form.updateInventoryPrice ? 24 : 3, width: 20, height: 20, borderRadius: "50%", background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
                  </button>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button className="btn btn-outline" onClick={() => { setShowModal(false); resetForm(); }}>Cancel</button>
                <button className="btn btn-primary" onClick={save}>
                  <Icon name="check" size={16} /> Purchase Save Karo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// CUSTOMERS
// ============================================================
const Customers = ({ customers, setCustomers, sales, showToast, isAdmin, highlightPhone, setGlobalInvoiceSale, setAppTab, setInventoryNav }) => {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("recent"); // recent|oldest|highest|visits|region
  const [regionFilter, setRegionFilter] = useState("all");
  const [selectedCustomer, setSelectedCustomer] = useState(() => {
    if (highlightPhone) return customers.find(c => c.phone === highlightPhone) || null;
    return null;
  });
  const [openBill, setOpenBill] = useState(null);
  const [activeTab, setActiveTab] = useState("bills"); // bills|analytics

  const getCustomerSales = (phone) =>
    [...sales.filter(s => s.phone === phone)].sort((a, b) => { const da = getCurrentVersion(b).date||b.date||""; const db = getCurrentVersion(a).date||a.date||""; return da.localeCompare(db) || b.id - a.id; });

  // ── Excel export ──
  const exportToExcel = () => {
    const rows = [];
    rows.push(["Customer Name","Phone","Region","Total Visits","Total Spent (₹)","Total Discount (₹)","Items Bought","Last Visit","Avg per Visit (₹)"]);
    customers.forEach(c => {
      const cSales = getCustomerSales(c.phone);
      const totalSpent = cSales.reduce((a,s)=>{ const cv=getCurrentVersion(s); return a+(cv.total||0); },0);
      const totalDisc = cSales.reduce((a,s)=>{ const cv=getCurrentVersion(s); return a+(cv.discount||0); },0);
      const totalItems = cSales.reduce((a,s)=>{ const cv=getCurrentVersion(s); return a+(cv.items||s.items||[]).reduce((b,it)=>b+it.qty,0); },0);
      const lastVisit = getCurrentVersion(cSales[0])?.date || cSales[0]?.date || "";
      const avg = cSales.length > 0 ? Math.round(totalSpent/cSales.length) : 0;
      const region = c.region==="local"?"Local":c.region==="out-city"?"Out City":c.region==="out-state"?"Out State":"Unknown";
      rows.push([c.name, c.phone, region, cSales.length, totalSpent, totalDisc, totalItems, lastVisit, avg]);
    });

    // Bills sheet - use current version data
    const billRows = [["Bill No","Date","Customer","Phone","Region","Items","Subtotal (₹)","Discount (₹)","Tax (₹)","Total Paid (₹)","Item Names"]];
    sales.forEach(s => {
      const cv = getCurrentVersion(s);
      const cust = customers.find(c => c.phone === s.phone);
      const region = cust?.region==="local"?"Local":cust?.region==="out-city"?"Out City":cust?.region==="out-state"?"Out State":"Unknown";
      const items = cv.items || s.items || [];
      const itemNames = items.map(it=>`${it.name} x${it.qty}`).join("; ");
      billRows.push([s.billNo, cv.date||s.date, s.customer, s.phone||"", region, items.reduce((a,it)=>a+it.qty,0), cv.subtotal||0, cv.discount||0, cv.tax||0, cv.total||0, itemNames]);
    });

    const toCSV = (rows) => rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const custCSV = "CUSTOMERS\n" + toCSV(rows) + "\n\nBILLS\n" + toCSV(billRows);
    const blob = new Blob(["\uFEFF" + custCSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `FashionPro_Export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    showToast("Excel/CSV export ho gaya! ✓");
  };

  const enrichCustomer = (c) => {
    const cSales = getCustomerSales(c.phone).filter(s => s && s.id);
    // Use getCurrentVersion so returns/replacements are reflected correctly
    const totalSpent = cSales.reduce((a, s) => a + (getCurrentVersion(s).total || 0), 0);
    const totalItems = cSales.reduce((a, s) => { const cv=getCurrentVersion(s); return a+(cv.items||[]).reduce((b, it) => b + (it?.qty||1), 0); }, 0);
    const totalDisc = cSales.reduce((a, s) => a + (getCurrentVersion(s).discount || 0), 0);
    const lastVisit = cSales.length > 0 ? (getCurrentVersion(cSales[0])?.date || cSales[0]?.date || "") : (c.date || "");
    return { ...c, totalSpent, totalItems, totalDisc, visits: cSales.length, lastVisit };
  };

  let filtered = customers
    .filter(c => {
      const q = search.toLowerCase();
      const match = c.name?.toLowerCase().includes(q) || c.phone?.includes(q);
      const regOk = regionFilter === "all" || c.region === regionFilter;
      return match && regOk;
    })
    .map(enrichCustomer);

  filtered.sort((a, b) => {
    if (sortBy === "recent") return new Date(b.lastVisit||0) - new Date(a.lastVisit||0);
    if (sortBy === "oldest") return new Date(a.lastVisit||0) - new Date(b.lastVisit||0);
    if (sortBy === "highest") return b.totalSpent - a.totalSpent;
    if (sortBy === "visits") return b.visits - a.visits;
    if (sortBy === "region") return (a.region||"").localeCompare(b.region||"");
    return 0;
  });

  // Region analytics
  const regionData = ["local","out-city","out-state",""].map(r => {
    const label = r==="local"?"🏠 Local":r==="out-city"?"🌆 Out City":r==="out-state"?"✈️ Out State":"❓ Unknown";
    const cList = customers.filter(c => (c.region||"") === r);
    const spent = cList.reduce((a, c) => {
      return a + getCustomerSales(c.phone).reduce((b, s) => b + (getCurrentVersion(s).total||0), 0);
    }, 0);
    return { label, count: cList.length, spent };
  }).filter(r => r.count > 0);

  // Category preference per region
  // eslint-disable-next-line no-unused-vars
  const regionCategoryData = () => {
    const data = {};
    sales.forEach(s => {
      const cust = customers.find(c => c.phone === s.phone);
      const region = cust?.region || "unknown";
      (s.items||[]).forEach(it => {
        const key = `${region}__${it.name}`;
        data[key] = (data[key] || 0) + it.qty;
      });
    });
    return data;
  };

  const selC = selectedCustomer ? enrichCustomer(selectedCustomer) : null;
  const selSales = selC ? getCustomerSales(selC.phone) : [];

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:12 }}>
          {/* Search */}
          <div style={{ position:"relative", flex:1, minWidth:200 }}>
            <svg style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#9ca3af" }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="input" style={{ paddingLeft:40 }} placeholder="Phone ya naam se dhundo..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Sort */}
          <select className="select" style={{ width:170 }} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="recent">🕐 Recent Visit</option>
            <option value="oldest">📅 Oldest First</option>
            <option value="highest">💰 Highest Value</option>
            <option value="visits">🔁 Most Visits</option>
            <option value="region">📍 Region</option>
          </select>
          {/* Region filter */}
          <select className="select" style={{ width:150 }} value={regionFilter} onChange={e=>setRegionFilter(e.target.value)}>
            <option value="all">🌐 All Regions</option>
            <option value="local">🏠 Local</option>
            <option value="out-city">🌆 Out City</option>
            <option value="out-state">✈️ Out State</option>
          </select>
          {/* Excel Export */}
          <button onClick={exportToExcel} className="btn btn-outline"
            style={{ whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6, fontWeight:700, borderColor:"#059669", color:"#059669" }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Excel Export
          </button>
        </div>
        {/* Stats row */}
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {[
            ["👥 Total",customers.length,"#7c3aed"],
            ["⭐ Regular (5+ visits)",customers.filter(c=>getCustomerSales(c.phone).length>=5).length,"#f59e0b"],
            ["🆕 New (1 visit)",customers.filter(c=>getCustomerSales(c.phone).length<=1).length,"#059669"],
            ["🏠 Local",customers.filter(c=>c.region==="local").length,"#2563eb"],
          ].map(([l,v,c]) => (
            <div key={l} className="card" style={{ padding:"8px 14px", display:"flex", alignItems:"center", gap:8, flex:"0 0 auto" }}>
              <span style={{ fontSize:11, color:"#9ca3af", fontWeight:600 }}>{l}</span>
              <span style={{ fontSize:18, fontWeight:800, color:c }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns: selectedCustomer?"1fr 440px":"1fr", gap:20, alignItems:"start" }}>

        {/* Customer List */}
        <div className="card" style={{ padding:0, overflow:"hidden" }}>
          {filtered.length === 0 ? (
            <div style={{ padding:40, textAlign:"center", color:"#9ca3af" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>👤</div>
              <p>Koi customer nahi mila</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th><th>Region</th><th>Visits</th>
                  <th>Total Spent</th><th>Last Visit</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ cursor:"pointer", background: selectedCustomer?.id===c.id?"#f5f3ff":"" }}
                    onClick={() => { setSelectedCustomer(c); setActiveTab("bills"); }}>
                    <td>
                      <div style={{ fontWeight:700, fontSize:13 }}>{c.name}</div>
                      <div style={{ fontSize:11, color:"#9ca3af" }}>{c.phone}</div>
                    </td>
                    <td>
                      <span style={{ fontSize:11, background: c.region==="local"?"#eff6ff":c.region==="out-city"?"#f0fdf4":c.region==="out-state"?"#faf5ff":"#f9fafb",
                        color: c.region==="local"?"#2563eb":c.region==="out-city"?"#059669":c.region==="out-state"?"#7c3aed":"#9ca3af",
                        padding:"2px 8px", borderRadius:6, fontWeight:600 }}>
                        {c.region==="local"?"🏠 Local":c.region==="out-city"?"🌆 Out City":c.region==="out-state"?"✈️ Out State":"—"}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight:700, color: c.visits>=5?"#f59e0b":c.visits>=2?"#059669":"#6b7280" }}>
                        {c.visits} {c.visits>=5?"⭐":""}
                      </span>
                    </td>
                    <td><span style={{ fontWeight:700, color:"#7c3aed" }}>₹{c.totalSpent.toLocaleString()}</span></td>
                    <td style={{ fontSize:11, color:"#9ca3af" }}>{fmtDateFriendly(c.lastVisit)}</td>
                    <td>
                      <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setSelectedCustomer(c);setActiveTab("bills");}}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Customer Detail Panel */}
        {selC && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Profile Card */}
            <div className="card">
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <h3 style={{ fontSize:17, fontWeight:800 }}>{selC.name}</h3>
                  <p style={{ fontSize:12, color:"#9ca3af" }}>{selC.phone}</p>
                  {selC.region && (
                    <span style={{ fontSize:11, fontWeight:700, color:"#7c3aed", background:"#f5f3ff", padding:"2px 8px", borderRadius:6, marginTop:4, display:"inline-block" }}>
                      {selC.region==="local"?"🏠 Local":selC.region==="out-city"?"🌆 Out City":"✈️ Out State"}
                    </span>
                  )}
                </div>
                <button onClick={() => setSelectedCustomer(null)} style={{ background:"#f3f4f6", border:"none", borderRadius:8, width:30, height:30, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Icon name="close" size={15} />
                </button>
              </div>
              {/* Stats grid */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  ["🛒 Total Visits", selC.visits],
                  ["💰 Total Spent", `₹${selC.totalSpent.toLocaleString()}`],
                  ["📦 Items Bought", selC.totalItems],
                  ["🏷️ Total Discounts", `₹${selC.totalDisc.toLocaleString()}`],
                  ["📅 Last Visit", fmtDateFriendly(selC.lastVisit)],
                  ["💎 Avg/Visit", selC.visits>0?`₹${Math.round(selC.totalSpent/selC.visits).toLocaleString()}`:"—"],
                ].map(([l,v]) => (
                  <div key={l} style={{ background:"#f9fafb", borderRadius:8, padding:"8px 12px" }}>
                    <div style={{ fontSize:10, color:"#9ca3af", fontWeight:600 }}>{l}</div>
                    <div style={{ fontSize:14, fontWeight:800, color:"#111827" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", gap:6 }}>
              {[["bills","📄 Bill History"],["analytics","📊 Analytics"]].map(([id,label])=>(
                <button key={id} onClick={()=>setActiveTab(id)} className="btn"
                  style={{ flex:1, justifyContent:"center", fontSize:12,
                    background:activeTab===id?"linear-gradient(135deg,#7c3aed,#a855f7)":"white",
                    color:activeTab===id?"white":"#6b7280",
                    border:activeTab===id?"none":"1.5px solid #e5e7eb" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Bill History Tab */}
            {activeTab==="bills" && (
              <div className="card" style={{ padding:0, overflow:"hidden" }}>
                {selSales.length===0 ? (
                  <div style={{ padding:24, textAlign:"center", color:"#9ca3af" }}>Koi bill nahi mila</div>
                ) : [...selSales].sort((a,b) => new Date(b.date||0) - new Date(a.date||0)).map((s, idx) => {
                  const cv = s.versions ? s.versions[s.currentVersion ?? s.versions.length-1] : s;
                  const items = cv.items || s.items || [];
                  const sm = calcBillSummary(cv.items ? cv : s);
                  const preview = items.slice(0,3).map(it => `${it.name}${it.qty>1?` ×${it.qty}`:""}`).join(", ");
                  const moreCount = items.length - 3;
                  return (
                    <div key={s.id}
                      onClick={() => setGlobalInvoiceSale ? setGlobalInvoiceSale(s) : setOpenBill(s)}
                      style={{ padding:"12px 14px", borderBottom:"1px solid #f3f4f6", cursor:"pointer", transition:"background 0.15s" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#f5f3ff"}
                      onMouseLeave={e=>e.currentTarget.style.background="white"}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                        <div>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ fontWeight:700, fontSize:13 }}>{s.billNo}</span>
                            {idx===0 && <span style={{ fontSize:9, background:"#d1fae5", color:"#065f46", padding:"1px 6px", borderRadius:8, fontWeight:700 }}>Latest</span>}
                          </div>
                          <div style={{ fontSize:11, color:"#9ca3af", marginTop:1 }}>
                            📅 {fmtDateFriendly(s.date)}{s.date && s.date.length > 10 ? " · " + fmtBillTime(s.date) : ""} • {items.length} item{items.length!==1?"s":""}
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontWeight:800, fontSize:14, color:"#059669" }}>₹{(cv.total??s.total??0).toLocaleString()}</div>
                          {sm.totalSavings > 0 && <div style={{ fontSize:10, color:"#d97706", fontWeight:600 }}>saved ₹{sm.totalSavings}</div>}
                        </div>
                      </div>
                      {/* Item preview */}
                      <div style={{ fontSize:11, color:"#6b7280", background:"#f9fafb", borderRadius:6, padding:"4px 8px", marginTop:2 }}>
                        {preview}{moreCount>0?` +${moreCount} more`:""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Analytics Tab */}
            {activeTab==="analytics" && (
              <div className="card">
                <h4 style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>🛍️ Items Purchased</h4>
                {(() => {
                  const itemCounts = {};
                  selSales.forEach(s => (s.items||[]).forEach(it => {
                    itemCounts[it.name] = (itemCounts[it.name]||0) + it.qty;
                  }));
                  return Object.entries(itemCounts).sort((a,b)=>b[1]-a[1]).map(([name,qty]) => (
                    <div key={name} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"4px 0", borderBottom:"1px solid #f3f4f6" }}>
                      <span>{name}</span><span style={{ fontWeight:700, color:"#7c3aed" }}>{qty} pcs</span>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Region Analytics Card */}
      {regionData.length > 0 && (
        <div className="card" style={{ marginTop:20 }}>
          <h3 style={{ fontSize:14, fontWeight:700, marginBottom:14 }}>📍 Region Analytics</h3>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:10, marginBottom:16 }}>
            {regionData.map(r => (
              <div key={r.label} style={{ background:"#f9fafb", borderRadius:10, padding:"10px 14px" }}>
                <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>{r.label}</div>
                <div style={{ fontSize:11, color:"#9ca3af" }}>{r.count} customers</div>
                <div style={{ fontSize:16, fontWeight:800, color:"#7c3aed" }}>₹{r.spent.toLocaleString()}</div>
              </div>
            ))}
          </div>
          {/* Top items per region */}
          <h4 style={{ fontSize:12, fontWeight:700, color:"#6b7280", marginBottom:8 }}>🔥 Popular Items by Region</h4>
          {(() => {
            const regionItems = {};
            sales.forEach(s => {
              const cust = customers.find(c => c.phone === s.phone);
              const region = cust?.region || "unknown";
              (s.items||[]).forEach(it => {
                if(!regionItems[region]) regionItems[region]={};
                regionItems[region][it.name] = (regionItems[region][it.name]||0)+it.qty;
              });
            });
            return Object.entries(regionItems).map(([region, items]) => {
              const label = region==="local"?"🏠 Local":region==="out-city"?"🌆 Out City":region==="out-state"?"✈️ Out State":"❓ Unknown";
              const top = Object.entries(items).sort((a,b)=>b[1]-a[1]).slice(0,3);
              if(top.length===0) return null;
              return (
                <div key={region} style={{ marginBottom:6 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#374151" }}>{label}: </span>
                  {top.map(([name,qty],i)=>(
                    <span key={name} style={{ fontSize:11, color:"#9ca3af" }}>{name} ({qty}){i<top.length-1?", ":""}</span>
                  ))}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Bill Detail Modal */}
      {openBill && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:520 }}>
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
              <div>
                <h3 style={{ fontSize:17, fontWeight:800, color:"#111827" }}>{openBill.billNo}</h3>
                <p style={{ fontSize:12, color:"#9ca3af", marginTop:2 }}>
                  {fmtDateFriendly(openBill.date)}{openBill.date && openBill.date.length > 10 ? " · " + fmtBillTime(openBill.date) : ""} • {openBill.customer}{openBill.phone ? ` • 📞 ${openBill.phone}` : ""}
                </p>
              </div>
              <button onClick={()=>setOpenBill(null)} style={{ background:"#f3f4f6", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Icon name="close" size={15} />
              </button>
            </div>

            {/* Items */}
            <div style={{ background:"#f9fafb", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
              {(openBill.items||[]).map((item, i) => {
                const mrpPc = item.mrpPerPiece || 0;
                const qty = item.qty || 1;
                const ratePc = item.price;
                const mrpTotal = mrpPc > 0 ? mrpPc * qty : ratePc * qty;
                const rateTotal = ratePc * qty;
                const mrpSaving = mrpPc > ratePc ? (mrpPc - ratePc) * qty : 0;
                const iDiscRs = item.itemDiscountRs || 0;
                const settled = item.settledDisc || 0;
                const afterDisc = rateTotal - iDiscRs - settled;
                const hasMRP = mrpPc > ratePc;
                const isLast = i === (openBill.items.length - 1);

                return (
                  <div key={i} style={{ paddingBottom: isLast ? 0 : 10, marginBottom: isLast ? 0 : 10, borderBottom: isLast ? "none" : "1px solid #e5e7eb" }}>
                    {/* Name */}
                    <div style={{ fontWeight:700, fontSize:13.5, color:"#111827", marginBottom:3 }}>
                      {item.name}
                      {item.size && item.size !== "-" && <span style={{ fontSize:11, color:"#9ca3af", fontWeight:400, marginLeft:5 }}>({item.size}{item.color&&item.color!=="-"?`/${item.color}`:""})</span>}
                    </div>
                    {/* MRP row */}
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#9ca3af", marginBottom:2 }}>
                      <span>MRP: ₹{mrpPc > 0 ? mrpPc : ratePc}/pc × {qty}</span>
                      <span style={{ textDecoration: hasMRP ? "line-through" : "none", fontWeight:600, color: hasMRP ? "#9ca3af" : "#374151" }}>₹{mrpTotal.toLocaleString()}</span>
                    </div>
                    {/* MRP discount */}
                    {mrpSaving > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11.5, color:"#d97706", paddingLeft:10, marginBottom:2 }}>
                        <span>🏷️ MRP se sasta (₹{mrpPc-ratePc}/pc × {qty})</span>
                        <span style={{ fontWeight:700 }}>−₹{mrpSaving}</span>
                      </div>
                    )}
                    {/* Rate row */}
                    {hasMRP && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#374151", paddingLeft:10, marginBottom:2 }}>
                        <span>Rate: ₹{ratePc}/pc × {qty}</span>
                        <span style={{ fontWeight:600 }}>₹{rateTotal.toLocaleString()}</span>
                      </div>
                    )}
                    {/* Item discount */}
                    {iDiscRs > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11.5, color:"#059669", paddingLeft:10, marginBottom:2 }}>
                        <span>Item Discount{qty>1?` (₹${Math.round(iDiscRs/qty)}/pc × ${qty})`:""}</span>
                        <span style={{ fontWeight:700 }}>−₹{iDiscRs}</span>
                      </div>
                    )}
                    {/* Settlement */}
                    {settled > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11.5, color:"#f59e0b", paddingLeft:10, marginBottom:2 }}>
                        <span>Customer ne kam diya</span>
                        <span style={{ fontWeight:700 }}>−₹{settled}</span>
                      </div>
                    )}
                    {/* Final */}
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13.5, fontWeight:800, color:"#059669", marginTop:4 }}>
                      <span>Item Total</span><span>₹{afterDisc.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Payment Summary */}
            <div style={{ background:"#f0fdf4", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
              {(() => {
                const s = calcBillSummary(openBill);
                const totalDiscount = s.mrpDiscount + s.itemDiscTotal + s.billDiscAmt + s.legacyDisc + s.settledTotal;
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {/* MRP Subtotal */}
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color: s.mrpDiscount>0?"#9ca3af":"#374151", fontWeight:600 }}>
                      <span>Subtotal ({(openBill.items||[]).reduce((a,b)=>a+(b.qty||1),0)} items)</span>
                      <span style={{ textDecoration: s.mrpDiscount>0?"line-through":"none" }}>₹{s.mrpSubtotal.toLocaleString()}</span>
                    </div>
                    {/* MRP savings */}
                    {s.mrpDiscount > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#d97706", fontWeight:700 }}>
                        <span>🏷️ MRP se sasta</span><span>−₹{s.mrpDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    {s.mrpDiscount > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#374151", fontWeight:600 }}>
                        <span>Rate Subtotal</span><span>₹{s.rateSubtotal.toLocaleString()}</span>
                      </div>
                    )}
                    {/* Discounts */}
                    {s.itemDiscTotal > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#059669" }}><span>Item Discount</span><span style={{ fontWeight:700 }}>−₹{s.itemDiscTotal}</span></div>}
                    {s.billDiscAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#7c3aed" }}><span>Bill Discount</span><span style={{ fontWeight:700 }}>−₹{s.billDiscAmt}</span></div>}
                    {s.legacyDisc > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#059669" }}><span>Discount</span><span style={{ fontWeight:700 }}>−₹{s.legacyDisc}</span></div>}
                    {s.taxAmt > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#d97706" }}><span>GST</span><span>+₹{s.taxAmt}</span></div>}
                    {s.settledTotal > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, color:"#f59e0b" }}><span>📉 Customer ne kam diya</span><span style={{ fontWeight:700 }}>−₹{s.settledTotal}</span></div>}
                    {/* Total Discount badge */}
                    {totalDiscount > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#15803d", fontWeight:700, background:"#dcfce7", borderRadius:6, padding:"4px 8px" }}>
                        <span>🎁 Total Discount</span><span>−₹{totalDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    {/* PAID */}
                    <div style={{ borderTop:"1.5px solid #6ee7b7", paddingTop:8, marginTop:4, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:14, fontWeight:800, color:"#065f46" }}>✅ TOTAL PAID</span>
                      <span style={{ fontSize:20, fontWeight:900, color:"#059669" }}>₹{openBill.total?.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <button onClick={()=>setOpenBill(null)} className="btn btn-outline" style={{ width:"100%", justifyContent:"center" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// REPORTS
// ============================================================
const Reports = ({ sales, products, purchases, customers, setGlobalInvoiceSale }) => {
  const [period, setPeriod] = useState("all");
  const [activeReport, setActiveReport] = useState("sales");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date_desc");
  const [searchQ, setSearchQ] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [invSortBy, setInvSortBy] = useState("name");
  const [invCategory, setInvCategory] = useState("all");
  const [invStockFilter, setInvStockFilter] = useState("all"); // all|low|out|ok

  const rcv = (s) => { if (!s) return {}; return (s.versions && s.versions.length > 0) ? (s.versions[s.currentVersion ?? s.versions.length - 1] || s.versions[0] || s) : s; };

  const filterSales = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    let result = [...sales];
    // Date filter
    if (period === "today") result = result.filter(s => (rcv(s).date||s.date) === todayStr);
    else if (period === "week") { const d = new Date(); d.setDate(d.getDate()-7); result = result.filter(s => new Date(rcv(s).date||s.date) >= d); }
    else if (period === "month") { const d = new Date(); d.setDate(d.getDate()-30); result = result.filter(s => new Date(rcv(s).date||s.date) >= d); }
    else if (period === "custom" && customFrom) {
      result = result.filter(s => {
        const d = rcv(s).date||s.date;
        return d >= customFrom && (!customTo || d <= customTo);
      });
    }
    // Region filter
    if (regionFilter !== "all") result = result.filter(s => (s.region||"") === regionFilter);
    // Search (customer name / bill no / item name)
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      result = result.filter(s =>
        (s.customer||"").toLowerCase().includes(q) ||
        (s.billNo||"").toLowerCase().includes(q) ||
        (s.phone||"").includes(q) ||
        (rcv(s).items||[]).some(it => it.name.toLowerCase().includes(q))
      );
    }
    // Amount filter
    if (minAmount) result = result.filter(s => rcv(s).total >= +minAmount);
    if (maxAmount) result = result.filter(s => rcv(s).total <= +maxAmount);
    // Sort
    result.sort((a, b) => {
      const av = rcv(a), bv = rcv(b);
      if (sortBy === "date_desc") return new Date(bv.date||b.date) - new Date(av.date||a.date);
      if (sortBy === "date_asc") return new Date(av.date||a.date) - new Date(bv.date||b.date);
      if (sortBy === "amount_desc") return bv.total - av.total;
      if (sortBy === "amount_asc") return av.total - bv.total;
      if (sortBy === "customer") return (a.customer||"").localeCompare(b.customer||"");
      if (sortBy === "items_desc") return (rcv(b).items||[]).reduce((s,i)=>s+i.qty,0) - (rcv(a).items||[]).reduce((s,i)=>s+i.qty,0);
      return 0;
    });
    return result;
  };

  const filteredSales = filterSales();
  const revenue = filteredSales.reduce((a, b) => a + rcv(b).total, 0);
  const totalItemsSold = filteredSales.reduce((a, b) => a + (rcv(b).items||b.items||[]).reduce((c, d) => c + d.qty, 0), 0);
  const getItemCost = (d) => {
    const p = products.find(x => x.id === d.productId || x.name === d.name);
    if (!p) return 0;
    if (p.pricingType === "size-variant" && d.size && d.size !== "-") {
      const sv = p.sizeVariants?.find(s => s.size === d.size);
      if (sv) return (sv.purchasePrice || 0) * d.qty;
    }
    return (p.purchasePrice || 0) * d.qty;
  };
  const cost = filteredSales.reduce((a, b) => a + (rcv(b).items||b.items||[]).reduce((c, d) => c + getItemCost(d), 0), 0);
  const profit = revenue - cost;
  const totalPurchased = purchases.reduce((a, b) => a + b.total, 0);
  const lowStock = products.filter(p => p.quantity <= 5);
  const stockValue = products.reduce((a, b) => a + b.sellingPrice * b.quantity, 0);

  const categories = ["all", ...new Set(products.map(p=>p.category).filter(Boolean))];

  const filteredProducts = () => {
    let result = [...products];
    if (invCategory !== "all") result = result.filter(p => p.category === invCategory);
    if (invStockFilter === "low") result = result.filter(p => p.quantity > 0 && p.quantity <= 5);
    else if (invStockFilter === "out") result = result.filter(p => p.quantity === 0);
    else if (invStockFilter === "ok") result = result.filter(p => p.quantity > 5);
    result.sort((a,b) => {
      if (invSortBy === "name") return a.name.localeCompare(b.name);
      if (invSortBy === "stock_asc") return a.quantity - b.quantity;
      if (invSortBy === "stock_desc") return b.quantity - a.quantity;
      if (invSortBy === "value_desc") return (b.quantity*b.sellingPrice) - (a.quantity*a.sellingPrice);
      if (invSortBy === "margin_desc") return (b.sellingPrice-b.purchasePrice) - (a.sellingPrice-a.purchasePrice);
      return 0;
    });
    return result;
  };

  const exportToExcel = () => {
    const toCSV = (headers, rows) => [headers, ...rows].map(r => r.map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(",")).join("\n");
    const salesRows = filteredSales.map(s => {
      const v = rcv(s);
      return [s.billNo, s.customer||"Walk-in", s.phone||"", s.region||"", v.date||"",
        v.subtotal||0, v.itemDiscountTotal||0, v.billDiscount||0, v.discount||0, v.tax||0, v.total||0,
        v.received||v.total||0, v.type||"original"];
    });
    const salesCSV = toCSV(["Bill No","Customer","Phone","Region","Date","MRP Total","Item Discount","Bill Discount","Total Discount","GST","Amount Paid","Received","Type"], salesRows);
    const itemRows = [];
    filteredSales.forEach(s => {
      const v = rcv(s);
      (v.items||[]).forEach(it => {
        itemRows.push([s.billNo, s.customer||"Walk-in", v.date||"", it.name, it.size||"-", it.color||"-",
          it.qty, it.price, it.price*it.qty, it.itemDiscountRs||0, it.effectiveTotal??it.price*it.qty]);
      });
    });
    const itemsCSV = toCSV(["Bill No","Customer","Date","Product","Size","Color","Qty","Rate","MRP Total","Item Disc","Final Paid"], itemRows);
    const custRows = customers.map(c => [c.name, c.phone||"", c.email||"", c.region||"", c.visits||0, c.totalSpent||0]);
    const custCSV = toCSV(["Name","Phone","Email","Region","Visits","Total Spent"], custRows);
    const invRows = products.map(p => [p.sku||"", p.name, p.category, p.brand||"", p.quantity, p.purchasePrice, p.sellingPrice, p.sellingPrice-p.purchasePrice, p.supplier||""]);
    const invCSV = toCSV(["SKU","Name","Category","Brand","Stock","Purchase Price","Selling Price","Margin","Supplier"], invRows);
    const combined = `SALES REPORT\n${salesCSV}\n\n\nITEM-WISE DETAILS\n${itemsCSV}\n\n\nCUSTOMERS\n${custCSV}\n\n\nINVENTORY\n${invCSV}`;
    const blob = new Blob([combined], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `FashionPro_Report_${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const tabReports = [
    { id: "sales", label: "📋 Sales" },
    { id: "inventory", label: "📦 Inventory" },
    { id: "profit", label: "💰 Profit" },
  ];

  const chip = (active, onClick, label) => (
    <button onClick={onClick} style={{ padding:"4px 12px", fontSize:11.5, fontWeight:600, borderRadius:20, border:`1.5px solid ${active?"#7c3aed":"#e5e7eb"}`, background:active?"#f5f3ff":"white", color:active?"#7c3aed":"#6b7280", cursor:"pointer", whiteSpace:"nowrap" }}>{label}</button>
  );

  return (
    <div className="page">
      {/* Tab + Export row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap:"wrap", gap:8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {tabReports.map(t => (
            <button key={t.id} onClick={() => setActiveReport(t.id)} className="btn" style={{ background: activeReport === t.id ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "white", color: activeReport === t.id ? "white" : "#6b7280", border: activeReport === t.id ? "none" : "1.5px solid #e5e7eb" }}>{t.label}</button>
          ))}
        </div>
        <button onClick={exportToExcel} className="btn" style={{ background:"#059669", color:"white", fontWeight:700, gap:6 }}>📊 Export CSV</button>
      </div>

      {/* ── SALES FILTERS ── */}
      {activeReport === "sales" && (
        <div className="card" style={{ marginBottom:16, padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
          {/* Row 1: Period chips */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af", marginRight:2 }}>Period:</span>
            {[["today","Today"],["week","7 Days"],["month","30 Days"],["all","All Time"],["custom","Custom"]].map(([v,l])=>chip(period===v,()=>setPeriod(v),l))}
            {period === "custom" && (
              <>
                <input type="date" className="input" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} style={{ width:130, padding:"4px 8px", fontSize:12 }} />
                <span style={{ fontSize:12, color:"#9ca3af" }}>to</span>
                <input type="date" className="input" value={customTo} onChange={e=>setCustomTo(e.target.value)} style={{ width:130, padding:"4px 8px", fontSize:12 }} />
              </>
            )}
          </div>
          {/* Row 2: Region + Search */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Region:</span>
            {[["all","All"],["local","🏠 Local"],["out-city","🌆 Out City"],["out-state","✈️ Out State"]].map(([v,l])=>chip(regionFilter===v,()=>setRegionFilter(v),l))}
            <input className="input" value={searchQ} onChange={e=>setSearchQ(e.target.value)}
              placeholder="🔍 Customer / Bill No / Item..." style={{ flex:1, minWidth:180, padding:"5px 10px", fontSize:12 }} />
          </div>
          {/* Row 3: Amount range + Sort */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Amount:</span>
            <input className="input" type="number" onWheel={e=>e.target.blur()} value={minAmount} onChange={e=>setMinAmount(e.target.value)} placeholder="Min ₹" style={{ width:90, padding:"5px 8px", fontSize:12 }} />
            <span style={{ fontSize:12, color:"#9ca3af" }}>—</span>
            <input className="input" type="number" onWheel={e=>e.target.blur()} value={maxAmount} onChange={e=>setMaxAmount(e.target.value)} placeholder="Max ₹" style={{ width:90, padding:"5px 8px", fontSize:12 }} />
            <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af", marginLeft:8 }}>Sort:</span>
            <select className="select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ padding:"5px 8px", fontSize:12, width:"auto" }}>
              <option value="date_desc">Date ↓ (Latest first)</option>
              <option value="date_asc">Date ↑ (Oldest first)</option>
              <option value="amount_desc">Amount ↓ (Highest)</option>
              <option value="amount_asc">Amount ↑ (Lowest)</option>
              <option value="customer">Customer A-Z</option>
              <option value="items_desc">Most Items</option>
            </select>
            {(searchQ||minAmount||maxAmount||regionFilter!=="all"||period!=="all") && (
              <button onClick={()=>{setSearchQ("");setMinAmount("");setMaxAmount("");setRegionFilter("all");setPeriod("all");}} style={{ padding:"4px 10px", fontSize:11, color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:8, background:"white", cursor:"pointer", fontWeight:600 }}>✕ Clear</button>
            )}
          </div>
          <div style={{ fontSize:11, color:"#9ca3af" }}>
            {filteredSales.length} bills • ₹{revenue.toLocaleString()} revenue • ₹{profit.toLocaleString()} profit
          </div>
        </div>
      )}

      {/* ── INVENTORY FILTERS ── */}
      {activeReport === "inventory" && (
        <div className="card" style={{ marginBottom:16, padding:"12px 16px", display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Category:</span>
          {categories.map(c=>chip(invCategory===c,()=>setInvCategory(c),c==="all"?"All":c))}
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af", marginLeft:8 }}>Stock:</span>
          {[["all","All"],["ok","✅ OK"],["low","⚠️ Low (≤5)"],["out","❌ Out"]].map(([v,l])=>chip(invStockFilter===v,()=>setInvStockFilter(v),l))}
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af", marginLeft:8 }}>Sort:</span>
          <select className="select" value={invSortBy} onChange={e=>setInvSortBy(e.target.value)} style={{ padding:"5px 8px", fontSize:12, width:"auto" }}>
            <option value="name">Name A-Z</option>
            <option value="stock_asc">Stock ↑ (Low first)</option>
            <option value="stock_desc">Stock ↓ (High first)</option>
            <option value="value_desc">Stock Value ↓</option>
            <option value="margin_desc">Margin ↓ (Best first)</option>
          </select>
        </div>
      )}

      {activeReport === "sales" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
            {[["Revenue", `₹${revenue.toLocaleString()}`, "#7c3aed"], ["Profit", `₹${profit.toLocaleString()}`, "#059669"], ["Items Sold", totalItemsSold, "#d97706"], ["Invoices", filteredSales.length, "#2563eb"]].map(([l, v, c]) => (
              <div key={l} className="card" style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>{l}</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</p>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-scroll-wrap" style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            <table className="table">
              <thead><tr><th>Bill No</th><th>Date</th><th>Customer</th><th>Region</th><th>Items</th><th>MRP Total</th><th>Discount</th><th>Total Paid</th></tr></thead>
              <tbody>
                {filteredSales.map(s => {
                  const v = rcv(s);
                  const sm = calcBillSummary(v.items ? v : s);
                  const vNo = s.versions?.length || 1;
                  return (
                  <tr key={s.id}
                    onClick={() => setGlobalInvoiceSale && setGlobalInvoiceSale(s)}
                    style={{ cursor:"pointer" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#f5f3ff"}
                    onMouseLeave={e=>e.currentTarget.style.background=""}
                  >
                    <td style={{ fontWeight:700, color:"#7c3aed" }}>
                      {s.billNo}
                      {vNo > 1 && <span style={{ fontSize:10, color:"#a855f7", marginLeft:4 }}>v{(s.currentVersion??0)+1}</span>}
                      <span style={{ display:"block", fontSize:9, color:"#c4b5fd" }}>tap to open →</span>
                    </td>
                    <td style={{ color: "#6b7280" }}>{fmtDateFriendly(v.date||s.date)}</td>
                    <td style={{ fontWeight: 600 }}>{s.customer}</td>
                    <td><span style={{ fontSize:11 }}>{s.region==="local"?"🏠":s.region==="out-city"?"🌆":s.region==="out-state"?"✈️":"—"}</span></td>
                    <td>{(v.items||s.items||[]).reduce((a,i)=>a+i.qty,0)} pcs</td>
                    <td>₹{sm.mrpSubtotal.toLocaleString()}</td>
                    <td style={{ color: "#059669" }}>{sm.totalSavings>0?`−₹${sm.totalSavings}`:"—"}</td>
                    <td style={{ fontWeight: 700 }}>₹{v.total}</td>
                  </tr>
                  );
                })}
                {filteredSales.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "#9ca3af", padding: 30 }}>No sales found</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {activeReport === "inventory" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
            {[["Total Products", products.length, "#7c3aed"], ["Total Stock", products.reduce((a, b) => a + b.quantity, 0), "#2563eb"], ["Stock Value", `₹${stockValue.toLocaleString()}`, "#059669"], ["Low Stock", lowStock.length, "#dc2626"]].map(([l, v, c]) => (
              <div key={l} className="card" style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>{l}</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</p>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead><tr><th>Product</th><th>Category</th><th>Brand</th><th>Stock</th><th>Purchase ₹</th><th>Sell ₹</th><th>Margin</th><th>Stock Value</th><th>Status</th></tr></thead>
              <tbody>
                {filteredProducts().map(p => {
                  const margin = p.purchasePrice > 0 ? Math.round((p.sellingPrice - p.purchasePrice) / p.sellingPrice * 100) : 0;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td><span className="badge badge-purple">{p.category}</span></td>
                      <td>{p.brand}</td>
                      <td style={{ fontWeight: 700, color: p.quantity===0?"#dc2626":p.quantity<=5?"#d97706":"#111827" }}>{p.quantity}</td>
                      <td>₹{p.purchasePrice}</td>
                      <td>₹{p.sellingPrice}</td>
                      <td style={{ fontWeight:700, color: margin>=30?"#059669":margin>=15?"#d97706":"#dc2626" }}>{margin}%</td>
                      <td style={{ fontWeight: 700 }}>₹{(p.quantity * p.sellingPrice).toLocaleString()}</td>
                      <td><span className={`badge ${p.quantity === 0 ? "badge-red" : p.quantity <= 5 ? "badge-yellow" : "badge-green"}`}>{p.quantity === 0 ? "Out" : p.quantity <= 5 ? "Low" : "OK"}</span></td>
                    </tr>
                  );
                })}
                {filteredProducts().length === 0 && <tr><td colSpan={9} style={{ textAlign:"center", color:"#9ca3af", padding:30 }}>No products found</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeReport === "profit" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
            {[["Total Revenue", `₹${sales.reduce((a, b) => a + rcv(b).total, 0).toLocaleString()}`, "#7c3aed"], ["Total Purchase Cost", `₹${totalPurchased.toLocaleString()}`, "#dc2626"], ["Net Profit", `₹${(sales.reduce((a, b) => a + rcv(b).total, 0) - totalPurchased).toLocaleString()}`, "#059669"]].map(([l, v, c]) => (
              <div key={l} className="card" style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>{l}</p>
                <p style={{ fontSize: 26, fontWeight: 800, color: c }}>{v}</p>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Sales by Category</h3>
              {CATEGORIES.map(cat => {
                const catSales = sales.filter(Boolean).reduce((a, s) => a + (s.items||[]).filter(i => { const p = products.find(x => x.id === i.productId); return p && p.category === cat; }).reduce((c, i) => c + i.price * i.qty, 0), 0);
                if (catSales === 0) return null;
                const maxCat = Math.max(...CATEGORIES.map(c => sales.filter(Boolean).reduce((a, s) => a + (s.items||[]).filter(i => { const p = products.find(x => x.id === i.productId); return p && p.category === c; }).reduce((cv, i) => cv + i.price * i.qty, 0), 0)));
                return (
                  <div key={cat} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{cat}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>₹{catSales.toLocaleString()}</span>
                    </div>
                    <div style={{ background: "#f3f4f6", borderRadius: 6, height: 8 }}>
                      <div style={{ width: `${(catSales / maxCat) * 100}%`, height: "100%", background: "linear-gradient(135deg,#7c3aed,#a855f7)", borderRadius: 6 }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Purchase Summary</h3>
              <table className="table">
                <thead><tr><th>Supplier</th><th>Orders</th><th>Total</th></tr></thead>
                <tbody>
                  {Object.entries(purchases.reduce((acc, p) => { acc[p.supplier] = acc[p.supplier] || { count: 0, total: 0 }; acc[p.supplier].count++; acc[p.supplier].total += p.total; return acc; }, {})).map(([sup, data]) => (
                    <tr key={sup}>
                      <td style={{ fontWeight: 600 }}>{sup}</td>
                      <td>{data.count}</td>
                      <td style={{ fontWeight: 700, color: "#dc2626" }}>₹{data.total.toLocaleString()}</td>
                    </tr>
                  ))}
                  {purchases.length === 0 && <tr><td colSpan={3} style={{ color: "#9ca3af", textAlign: "center", padding: 20 }}>No purchases recorded</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================
// SETTINGS
// ============================================================
// ============================================================
// MARGIN ANALYSIS (Admin only)
// ============================================================
const MarginAnalysis = ({ sales, products, setGlobalInvoiceSale }) => {
  // BUG21 FIX: productMap — ek baar O(n) banao, har jagah O(1) lookup
  const productMap = React.useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p; if (p.name) m[p.name.toLowerCase()] = p; });
    return m;
  }, [products]);

  const [period, setPeriod] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expandBill, setExpandBill] = useState(null);
  const [sortBy, setSortBy] = useState("date_desc");
  const [marginFilter, setMarginFilter] = useState("all"); // all|good|mid|low|loss
  const [searchQ, setSearchQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categories = ["all", ...new Set(products.map(p=>p.category).filter(Boolean))];

  // BUG21 FIX: productMap se O(1) lookup — products.find() O(n) tha
  const getPurchasePrice = (item) => {
    const prod = productMap[item.productId] || productMap[item.name?.toLowerCase()];
    if (!prod) return 0;
    if (prod.pricingType === "size-variant" && item.size && item.size !== "-") {
      const sv = prod.sizeVariants?.find(s => s.size === item.size);
      if (sv) return sv.purchasePrice || 0;
    }
    return prod.purchasePrice || 0;
  };

  // Filter bills
  const todayStr = getISTDateStr(); // BUG25 FIX: IST
  const filteredSales = sales.filter(s => {
    const d = s.date || "";
    if (period === "today" && d !== todayStr) return false;
    if (period === "week") { const dt = new Date(); dt.setDate(dt.getDate()-7); if (new Date(d) < dt) return false; }
    if (period === "month") { const dt = new Date(); dt.setDate(dt.getDate()-30); if (new Date(d) < dt) return false; }
    if (period === "custom") {
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      if (!(s.customer||"").toLowerCase().includes(q) && !(s.billNo||"").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Build bill rows with margin info
  const allBillRows = filteredSales.map(sale => {
    const cv = sale.versions?.[sale.currentVersion ?? 0] || sale;
    const items = cv.items || sale.items || [];
    let totalRevenue = 0, totalCost = 0, totalMRP = 0;
    const cvTotal = cv.total || sale.total || 0;
    // BUG7 FIX: proportional share galat tha jab discounts unevenly apply hote the
    // effTotal stored value use karo — woh exact hai. Fallback me item-level disc subtract karo
    const itemRateTotals = items.map(it => it.price * (it.qty||1));
    const itemRateSum = itemRateTotals.reduce((a,b)=>a+b, 0);
    const itemRows = items.map((item, idx) => {
      // BUG21 FIX: productMap O(1) lookup
      const prod = productMap[item.productId] || productMap[item.name?.toLowerCase()];
      const qty = item.qty || 1;
      // BUG7 FIX: stored effectiveTotal is the authoritative value
      // If not stored, compute from item-level fields (not proportional share)
      let effTotal;
      if (item.effectiveTotal !== undefined) {
        effTotal = item.effectiveTotal;
      } else {
        const iDiscRs = item.itemDiscountRs || 0;
        const settled = item.settledDisc || 0;
        const rateTotal = item.price * qty;
        // For bill discount: use proportional share only as last resort
        const proportional = itemRateSum > 0 ? Math.round(cvTotal * itemRateTotals[idx] / itemRateSum) : rateTotal;
        effTotal = iDiscRs > 0 ? Math.max(0, rateTotal - iDiscRs - settled) : proportional;
      }
      const purchasePrice = getPurchasePrice(item);
      const cost = purchasePrice * qty;
      const mrpPerPc = item.mrpPerPiece || 0;
      const margin = effTotal - cost;
      const marginPct = effTotal > 0 ? Math.round((margin / effTotal) * 100) : null;
      totalRevenue += effTotal;
      totalCost += cost;
      totalMRP += mrpPerPc > 0 ? mrpPerPc * qty : 0;
      return { item, qty, effTotal, cost, margin, marginPct, mrpPerPc, purchasePrice, category: prod?.category };
    });
    const totalMargin = totalRevenue - totalCost;
    // BUG7 FIX: marginPct base = totalRevenue (actual collected), not cost
    const totalMarginPct = totalRevenue > 0 && totalCost > 0 ? Math.round((totalMargin / totalRevenue) * 100) : null;
    return { sale, cv, itemRows, totalRevenue, totalCost, totalMRP, totalMargin, totalMarginPct };
  });

  // Apply margin + category filter
  const billRows = allBillRows.filter(b => {
    if (marginFilter === "good" && (b.totalMarginPct === null || b.totalMarginPct < 30)) return false;
    if (marginFilter === "mid" && (b.totalMarginPct === null || b.totalMarginPct < 15 || b.totalMarginPct >= 30)) return false;
    if (marginFilter === "low" && (b.totalMarginPct === null || b.totalMarginPct < 0 || b.totalMarginPct >= 15)) return false;
    if (marginFilter === "loss" && (b.totalMarginPct === null || b.totalMarginPct >= 0)) return false;
    if (categoryFilter !== "all" && !b.itemRows.some(ir => ir.category === categoryFilter)) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === "date_desc") return new Date(b.sale.date||0) - new Date(a.sale.date||0);
    if (sortBy === "date_asc") return new Date(a.sale.date||0) - new Date(b.sale.date||0);
    if (sortBy === "margin_desc") return (b.totalMarginPct||0) - (a.totalMarginPct||0);
    if (sortBy === "margin_asc") return (a.totalMarginPct||0) - (b.totalMarginPct||0);
    if (sortBy === "revenue_desc") return b.totalRevenue - a.totalRevenue;
    if (sortBy === "profit_desc") return b.totalMargin - a.totalMargin;
    return 0;
  });

  // Summary stats
  const grandRevenue = billRows.reduce((a, b) => a + b.totalRevenue, 0);
  const grandCost = billRows.reduce((a, b) => a + b.totalCost, 0);
  const grandMargin = grandRevenue - grandCost;
  const grandMarginPct = grandRevenue > 0 ? Math.round((grandMargin / grandRevenue) * 100) : 0;

  const marginColor = (pct) => pct === null ? "#9ca3af" : pct >= 30 ? "#059669" : pct >= 15 ? "#d97706" : pct >= 0 ? "#dc2626" : "#7f1d1d";
  const chip = (active, onClick, label) => (
    <button onClick={onClick} style={{ padding:"4px 12px", fontSize:11.5, fontWeight:600, borderRadius:20, border:`1.5px solid ${active?"#7c3aed":"#e5e7eb"}`, background:active?"#f5f3ff":"white", color:active?"#7c3aed":"#6b7280", cursor:"pointer", whiteSpace:"nowrap" }}>{label}</button>
  );

  return (
    <div style={{ padding: "20px 16px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1f2937,#374151)", borderRadius: 16, padding: "20px 24px", marginBottom: 20, color: "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>💰 Margin Analysis</h2>
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "4px 0 0" }}>Bill-wise aur item-wise profit breakdown</p>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#34d399" }}>₹{grandMargin.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>Total Margin</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fbbf24" }}>{grandMarginPct}%</div>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>Avg Margin%</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#60a5fa" }}>₹{grandRevenue.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>Revenue</div>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Filters */}
      <div className="card" style={{ marginBottom:16, padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
        {/* Period */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Period:</span>
          {[["today","Today"],["week","7 Days"],["month","30 Days"],["all","All Time"],["custom","Custom"]].map(([v,l])=>chip(period===v,()=>setPeriod(v),l))}
          {period === "custom" && (
            <>
              <input type="date" className="input" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{ width:130, padding:"4px 8px", fontSize:12 }} />
              <span style={{ fontSize:12, color:"#9ca3af" }}>to</span>
              <input type="date" className="input" value={toDate} onChange={e=>setToDate(e.target.value)} style={{ width:130, padding:"4px 8px", fontSize:12 }} />
            </>
          )}
        </div>
        {/* Margin bracket + Category */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Margin:</span>
          {[["all","All"],["good","✅ ≥30%"],["mid","⚡ 15-29%"],["low","⚠️ 0-14%"],["loss","❌ Loss"]].map(([v,l])=>chip(marginFilter===v,()=>setMarginFilter(v),l))}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Category:</span>
          {categories.map(c=>chip(categoryFilter===c,()=>setCategoryFilter(c),c==="all"?"All":c))}
        </div>
        {/* Search + Sort */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <input className="input" value={searchQ} onChange={e=>setSearchQ(e.target.value)}
            placeholder="🔍 Customer / Bill No..." style={{ flex:1, minWidth:160, padding:"5px 10px", fontSize:12 }} />
          <span style={{ fontSize:11, fontWeight:700, color:"#9ca3af" }}>Sort:</span>
          <select className="select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ padding:"5px 8px", fontSize:12, width:"auto" }}>
            <option value="date_desc">Date ↓ (Latest)</option>
            <option value="date_asc">Date ↑ (Oldest)</option>
            <option value="margin_desc">Margin% ↓ (Best)</option>
            <option value="margin_asc">Margin% ↑ (Worst)</option>
            <option value="revenue_desc">Revenue ↓</option>
            <option value="profit_desc">Profit ↓ (Most)</option>
          </select>
          {(searchQ||marginFilter!=="all"||categoryFilter!=="all"||period!=="all") && (
            <button onClick={()=>{setSearchQ("");setMarginFilter("all");setCategoryFilter("all");setPeriod("all");}} style={{ padding:"4px 10px", fontSize:11, color:"#dc2626", border:"1.5px solid #fecaca", borderRadius:8, background:"white", cursor:"pointer", fontWeight:600 }}>✕ Clear</button>
          )}
          <span style={{ fontSize:11, color:"#9ca3af", marginLeft:"auto" }}>{billRows.length} bills</span>
        </div>
      </div>

      {/* Warning if purchase price missing */}
      {billRows.some(b => b.totalCost === 0) && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#92400e" }}>
          ⚠️ Kuch products ka Purchase Price set nahi hai — unka margin 0 dikh raha hai. Inventory mein jaake Purchase Price add karo.
        </div>
      )}

      {/* Bill rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {billRows.length === 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>Koi bill nahi mila</div>
        )}
        {billRows.map(({ sale, cv, itemRows, totalRevenue, totalCost, totalMargin, totalMarginPct }) => (
          <div key={sale.id} style={{ border: "1.5px solid #e5e7eb", borderRadius: 14, overflow: "hidden", background: "white" }}>
            {/* Bill header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f9fafb" }}>
              <div
                onClick={() => setExpandBill(expandBill === sale.id ? null : sale.id)}
                style={{ flex:1, cursor: "pointer" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{sale.billNo} — {sale.customer || "Walk-in"}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{fmtDateFriendly(sale.date)}{sale.date && sale.date.length > 10 ? " · " + fmtBillTime(sale.date) : ""} • {itemRows.length} items</div>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Revenue</div>
                  <div style={{ fontWeight: 700 }}>₹{totalRevenue}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Cost</div>
                  <div style={{ fontWeight: 700, color: "#dc2626" }}>₹{totalCost}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Margin</div>
                  <div style={{ fontWeight: 800, color: marginColor(totalMarginPct) }}>
                    ₹{totalMargin} {totalMarginPct !== null ? `(${totalMarginPct}%)` : ""}
                  </div>
                </div>
                {/* Invoice open button */}
                <button
                  onClick={e => { e.stopPropagation(); setGlobalInvoiceSale && setGlobalInvoiceSale(sale); }}
                  style={{ background:"#ede9fe", border:"none", borderRadius:8, padding:"5px 9px", cursor:"pointer", fontSize:13, color:"#7c3aed", fontWeight:700, flexShrink:0 }}
                  title="Invoice kholo"
                >🧾</button>
                <span
                  onClick={() => setExpandBill(expandBill === sale.id ? null : sale.id)}
                  style={{ fontSize: 18, color: "#9ca3af", cursor:"pointer" }}>{expandBill === sale.id ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Item breakdown */}
            {expandBill === sale.id && (
              <div style={{ padding: "0 16px 14px" }}>
                {/* Item table header */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 80px 80px 80px 80px", gap: 8, padding: "10px 0 6px", borderBottom: "1.5px solid #f3f4f6", fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>
                  <span>Product</span>
                  <span style={{ textAlign: "center" }}>Qty</span>
                  <span style={{ textAlign: "right" }}>Purchase</span>
                  <span style={{ textAlign: "right" }}>Sold At</span>
                  <span style={{ textAlign: "right" }}>Margin ₹</span>
                  <span style={{ textAlign: "right" }}>Margin %</span>
                </div>
                {itemRows.map(({ item, qty, effTotal, cost, margin, marginPct, purchasePrice }, ii) => (
                  <div key={ii} style={{ display: "grid", gridTemplateColumns: "1fr 60px 80px 80px 80px 80px", gap: 8, padding: "8px 0", borderBottom: "1px solid #f9fafb", fontSize: 13, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>
                        {[item.size && item.size !== "-" ? `Size ${item.size}` : "", item.color && item.color !== "-" ? item.color : ""].filter(Boolean).join(" / ")}
                        {purchasePrice === 0 && <span style={{ color: "#ef4444", marginLeft: 6 }}>⚠️ No cost</span>}
                      </div>
                    </div>
                    <span style={{ textAlign: "center", fontWeight: 600 }}>×{qty}</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#dc2626", fontWeight: 600 }}>₹{cost}</div>
                      {qty > 1 && <div style={{ fontSize: 10, color: "#9ca3af" }}>₹{purchasePrice}/pc</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 600 }}>₹{effTotal}</div>
                      {qty > 1 && <div style={{ fontSize: 10, color: "#9ca3af" }}>₹{Math.round(effTotal/qty)}/pc</div>}
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: marginColor(marginPct) }}>₹{margin}</div>
                    <div style={{ textAlign: "right" }}>
                      {marginPct !== null ? (
                        <span style={{ fontWeight: 800, color: marginColor(marginPct), background: marginPct >= 30 ? "#f0fdf4" : marginPct >= 15 ? "#fffbeb" : "#fef2f2", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>
                          {marginPct}%
                        </span>
                      ) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </div>
                  </div>
                ))}
                {/* Bill total row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 80px 80px 80px 80px", gap: 8, padding: "10px 0 0", borderTop: "2px solid #e5e7eb", fontSize: 13, fontWeight: 800, marginTop: 4 }}>
                  <span style={{ color: "#374151" }}>TOTAL</span>
                  <span></span>
                  <div style={{ textAlign: "right", color: "#dc2626" }}>₹{totalCost}</div>
                  <div style={{ textAlign: "right", color: "#059669" }}>₹{totalRevenue}</div>
                  <div style={{ textAlign: "right", color: marginColor(totalMarginPct) }}>₹{totalMargin}</div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ color: marginColor(totalMarginPct), background: "#f9fafb", padding: "2px 8px", borderRadius: 6, fontSize: 13 }}>
                      {totalMarginPct !== null ? `${totalMarginPct}%` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};


// ============================================================
// PRODUCT SEARCH / LOOKUP
// ============================================================
const ProductSearch = ({ products, sales, purchases, isAdmin, setActiveTab, setInventoryNav }) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const inputRef = React.useRef(null);

  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Match by name (fuzzy) or SKU (exact prefix)
  const results = query.trim().length === 0 ? [] : products.filter(p => {
    const q = query.trim().toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku || "").toLowerCase().startsWith(q) ||
      (p.brand || "").toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q) ||
      (p.supplier || "").toLowerCase().includes(q)
    );
  }).slice(0, 12);

  // When a product is selected, compute full analytics
  const buildStats = (p) => {
    // All sales that include this product (match by name)
    const pSales = sales.filter(s =>
      (getCurrentVersion(s).items || s.items || []).filter(Boolean).some(it => it?.name?.toLowerCase() === p.name.toLowerCase())
    );

    let totalQtySold = 0, totalRevenue = 0, totalCost = 0;
    const sizeBreakdown = {}, colorBreakdown = {}, monthlyTrend = {};

    pSales.forEach(s => {
      const cv = getCurrentVersion(s);
      const cvItems = cv.items || s.items || [];
      const matchItems = cvItems.filter(it => it.name.toLowerCase() === p.name.toLowerCase());

      matchItems.forEach(it => {
        const qty = it.qty || 1;
        const ratePc = it.price || 0;
        const iDiscRs = it.itemDiscountRs || 0;
        const settled = it.settledDisc || 0;
        // BUG7 FIX: effectiveTotal stored value use karo — proportional share galat tha
        // Proportional formula: discount unevenly apply hone pe item ka revenue galat distribute hota tha
        const effTotal = it.effectiveTotal !== undefined
          ? it.effectiveTotal
          : Math.max(0, ratePc * qty - iDiscRs - settled);

        // BUG7 FIX: revenue = effTotal (actual collected for this item)
        // Pehle totalRateSum pe proportional share use hota tha — discount ke baad galat tha
        const revenue = effTotal;

        // Cost
        let costPc = 0;
        if (p.pricingType === "size-variant") {
          const sv = (p.sizeVariants || []).find(v => v.size === it.size);
          costPc = sv ? (sv.purchasePrice || 0) : 0;
        } else {
          costPc = p.purchasePrice || 0;
        }
        const cost = costPc * qty;

        totalQtySold += qty;
        totalRevenue += revenue;
        totalCost += cost;

        // Size breakdown
        if (it.size && it.size !== "-") {
          if (!sizeBreakdown[it.size]) sizeBreakdown[it.size] = { qty: 0, revenue: 0 };
          sizeBreakdown[it.size].qty += qty;
          sizeBreakdown[it.size].revenue += revenue;
        }
        // Color breakdown
        if (it.color && it.color !== "-") {
          colorBreakdown[it.color] = (colorBreakdown[it.color] || 0) + qty;
        }
        // Monthly trend
        const dateStr = cv.date || s.date || "";
        const month = dateStr.slice(0, 7); // YYYY-MM
        if (month) {
          if (!monthlyTrend[month]) monthlyTrend[month] = { qty: 0, revenue: 0 };
          monthlyTrend[month].qty += qty;
          monthlyTrend[month].revenue += revenue;
        }
      });
    });

    // Purchase history for this product
    const pPurchases = purchases.filter(p2 =>
      (p2.productId === p.id) || (p2.product || "").toLowerCase() === p.name.toLowerCase()
    );
    const totalPurchased = pPurchases.reduce((a, pu) => a + (pu.quantity || 0), 0);

    // Pricing info
    let sellingPrice = p.sellingPrice || 0;
    let purchasePrice = p.purchasePrice || 0;
    let mrp = p.mrp || 0;
    const isSV = p.pricingType === "size-variant" && p.sizeVariants?.length > 0;
    if (isSV) {
      const prices = p.sizeVariants.map(sv => sv.sellingPrice || 0).filter(Boolean);
      const costs = p.sizeVariants.map(sv => sv.purchasePrice || 0).filter(Boolean);
      const mrps = p.sizeVariants.map(sv => sv.mrp || sv.mrpPerPiece || 0).filter(Boolean);
      sellingPrice = prices.length ? Math.min(...prices) : 0;
      // eslint-disable-next-line no-unused-vars
      const sellingPriceMax = prices.length ? Math.max(...prices) : 0;
      purchasePrice = costs.length ? Math.round(costs.reduce((a,b)=>a+b,0)/costs.length) : 0;
      mrp = mrps.length ? Math.min(...mrps) : 0;
    }

    const margin = sellingPrice > 0 && purchasePrice > 0
      ? Math.round(((sellingPrice - purchasePrice) / sellingPrice) * 100) : null;
    const totalMargin = totalRevenue - totalCost;
    const totalMarginPct = totalRevenue > 0 && totalCost > 0
      ? Math.round((totalMargin / totalRevenue) * 100) : null;

    // Stock status
    const stock = p.quantity || 0;
    const stockStatus = stock === 0 ? "out" : stock <= 5 ? "low" : "ok";

    // Days since last sale
    const lastSaleDate = pSales.length > 0
      ? pSales.map(s => new Date(getCurrentVersion(s).date || s.date || 0)).sort((a,b)=>b-a)[0]
      : null;
    const daysSinceLastSale = lastSaleDate
      ? Math.floor((Date.now() - lastSaleDate.getTime()) / 86400000) : null;

    return {
      p, isSV, sellingPrice, purchasePrice, mrp, margin,
      totalQtySold, totalRevenue, totalCost, totalMargin, totalMarginPct,
      totalPurchased, pSales, pPurchases,
      sizeBreakdown, colorBreakdown, monthlyTrend,
      stock, stockStatus, lastSaleDate, daysSinceLastSale,
    };
  };

  const stats = selected ? buildStats(selected) : null;
  const marginColor = (pct) => pct === null ? "#9ca3af" : pct >= 30 ? "#059669" : pct >= 15 ? "#d97706" : "#dc2626";

  // Recent months sorted
  const trendMonths = stats
    ? Object.entries(stats.monthlyTrend).sort((a,b)=>a[0].localeCompare(b[0])).slice(-6)
    : [];
  const maxTrendQty = trendMonths.length ? Math.max(...trendMonths.map(([,v])=>v.qty)) : 1;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* ── Search Bar ── */}
      <div style={{ background:"linear-gradient(135deg,#1e1b4b,#312e81)", borderRadius:20, padding:"24px 24px 20px", marginBottom:20 }}>
        <h2 style={{ color:"white", fontWeight:800, fontSize:20, marginBottom:4 }}>🔍 Product Lookup</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12.5, marginBottom:16 }}>
          Name, SKU code, brand, category, ya supplier se search karo
        </p>
        <div style={{ position:"relative" }}>
          <input
            ref={inputRef}
            className="input"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); }}
            placeholder="🔎  e.g.  lux, TS-001, tirupur, underwear..."
            style={{ fontSize:16, padding:"13px 16px 13px 44px", borderRadius:12, border:"none",
              boxShadow:"0 0 0 3px rgba(168,85,247,0.3)", background:"white" }}
          />
          <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:18, pointerEvents:"none" }}>🔍</span>
          {query && (
            <button onClick={()=>{setQuery("");setSelected(null);inputRef.current?.focus();}}
              style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"#e5e7eb", border:"none", borderRadius:6, width:26, height:26, cursor:"pointer", fontSize:14, color:"#6b7280" }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Search Results ── */}
      {!selected && results.length > 0 && (
        <div className="card" style={{ padding:0, overflow:"hidden", marginBottom:20 }}>
          <div style={{ padding:"10px 16px", background:"#f9fafb", borderBottom:"1px solid #f3f4f6", fontSize:11, fontWeight:700, color:"#9ca3af", textTransform:"uppercase" }}>
            {results.length} result{results.length!==1?"s":""} — ek par click karo details dekhne ke liye
          </div>
          {results.map(p => {
            const isSV = p.pricingType === "size-variant" && p.sizeVariants?.length > 0;
            const sp = isSV ? (p.sizeVariants||[]).map(sv=>sv.sellingPrice).filter(Boolean) : [p.sellingPrice];
            const spMin = Math.min(...sp), spMax = Math.max(...sp);
            const pp = p.purchasePrice || (isSV ? Math.round((p.sizeVariants||[]).reduce((a,sv)=>a+(sv.purchasePrice||0),0)/Math.max((p.sizeVariants||[]).filter(sv=>sv.purchasePrice).length,1)) : 0);
            const mg = sp[0] > 0 && pp > 0 ? Math.round(((spMin - pp) / spMin) * 100) : null;
            const stock = p.quantity || 0;
            const stockStatus = stock === 0 ? "out" : stock <= 5 ? "low" : "ok";
            return (
              <div key={p.id}
                onClick={() => setSelected(p)}
                style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", borderBottom:"1px solid #f9fafb", cursor:"pointer", transition:"background 0.15s" }}
                onMouseEnter={e=>e.currentTarget.style.background="#f5f3ff"}
                onMouseLeave={e=>e.currentTarget.style.background="white"}
              >
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontWeight:700, fontSize:14, color:"#1f2937" }}>{p.name}</span>
                    <span style={{ fontSize:10, background:"#ede9fe", color:"#7c3aed", padding:"1px 7px", borderRadius:8, fontWeight:600, flexShrink:0 }}>{p.category}</span>
                    {p.sku && <span style={{ fontSize:10, background:"#f3f4f6", color:"#6b7280", padding:"1px 7px", borderRadius:8, fontWeight:600, flexShrink:0, fontFamily:"monospace" }}>{p.sku}</span>}
                  </div>
                  <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>
                    {p.brand && <span>{p.brand} · </span>}
                    {p.supplier && <span>🏭 {p.supplier}</span>}
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:14, flexShrink:0, marginLeft:12 }}>
                  {isAdmin && (
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:12, fontWeight:800, color:"#1f2937" }}>
                        ₹{spMin === spMax ? spMin : `${spMin}–${spMax}`}
                      </div>
                      {mg !== null && <div style={{ fontSize:10, fontWeight:700, color:marginColor(mg) }}>{mg}% margin</div>}
                    </div>
                  )}
                  <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:8,
                    background: stockStatus==="ok"?"#d1fae5":stockStatus==="low"?"#fef3c7":"#fee2e2",
                    color: stockStatus==="ok"?"#059669":stockStatus==="low"?"#d97706":"#dc2626" }}>
                    {stock > 0 ? `${stock} pcs` : "Out"}
                  </span>
                  <span style={{ color:"#c4b5fd" }}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!selected && query.trim().length > 0 && results.length === 0 && (
        <div className="card" style={{ textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
          <p style={{ fontWeight:700, fontSize:16, color:"#374151", marginBottom:6 }}>"{query}" nahi mila</p>
          <p style={{ color:"#9ca3af", fontSize:13 }}>Name, SKU, brand ya supplier se try karo</p>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop:14 }}
              onClick={() => { setActiveTab("inventory"); setInventoryNav({ type:"add", prefill:{ name: query } }); }}>
              + Inventory mein add karo
            </button>
          )}
        </div>
      )}

      {!selected && !query && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12 }}>
          {[
            { label:"Total Products", val:products.length, icon:"📦", color:"#7c3aed" },
            { label:"In Stock", val:products.filter(p=>p.quantity>5).length, icon:"✅", color:"#059669" },
            { label:"Low Stock", val:products.filter(p=>p.quantity>0&&p.quantity<=5).length, icon:"⚠️", color:"#d97706" },
            { label:"Out of Stock", val:products.filter(p=>p.quantity===0).length, icon:"❌", color:"#dc2626" },
          ].map(({label,val,icon,color}) => (
            <div key={label} className="card" style={{ textAlign:"center", padding:"18px 12px" }}>
              <div style={{ fontSize:26, marginBottom:6 }}>{icon}</div>
              <div style={{ fontSize:24, fontWeight:800, color }}>{val}</div>
              <div style={{ fontSize:11, color:"#9ca3af", marginTop:2, fontWeight:600 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Product Detail Panel ── */}
      {selected && stats && (
        <div>
          {/* Back button */}
          <button
            onClick={()=>setSelected(null)}
            style={{ display:"flex", alignItems:"center", gap:6, marginBottom:14, background:"none", border:"none", color:"#7c3aed", cursor:"pointer", fontWeight:600, fontSize:13, padding:"6px 0" }}>
            ← Wapas jaao
          </button>

          {/* Product Header Card */}
          <div className="card" style={{ marginBottom:14, background:"linear-gradient(135deg,#faf5ff,#ede9fe)", border:"1.5px solid #c4b5fd", padding:"20px 22px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
                  <h2 style={{ fontSize:22, fontWeight:900, color:"#1e1b4b" }}>{selected.name}</h2>
                  <span style={{ fontSize:11, background:"#7c3aed", color:"white", padding:"2px 9px", borderRadius:20, fontWeight:700 }}>{selected.category}</span>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {selected.sku && <span style={{ fontSize:12, background:"white", color:"#7c3aed", padding:"3px 10px", borderRadius:8, fontWeight:700, border:"1.5px solid #e9d5ff", fontFamily:"monospace" }}>🏷️ {selected.sku}</span>}
                  {selected.brand && <span style={{ fontSize:12, color:"#6b7280", padding:"3px 10px", background:"white", borderRadius:8, border:"1.5px solid #e5e7eb" }}>🏢 {selected.brand}</span>}
                  {selected.supplier && <span style={{ fontSize:12, color:"#6b7280", padding:"3px 10px", background:"white", borderRadius:8, border:"1.5px solid #e5e7eb" }}>🏭 {selected.supplier}</span>}
                </div>
                {!stats.isSV && (selected.sizes?.length > 0) && (
                  <div style={{ marginTop:8, display:"flex", gap:4, flexWrap:"wrap" }}>
                    {selected.sizes.map(s => <span key={s} style={{ fontSize:11, background:"white", color:"#374151", padding:"2px 8px", borderRadius:6, border:"1px solid #e5e7eb", fontWeight:600 }}>{s}</span>)}
                  </div>
                )}
                {(selected.colors?.length > 0) && (
                  <div style={{ marginTop:6, display:"flex", gap:4, flexWrap:"wrap" }}>
                    {(Array.isArray(selected.colors)?selected.colors:selected.colors.split(",").map(c=>c.trim())).map(c => <span key={c} style={{ fontSize:11, background:"#f9fafb", color:"#374151", padding:"2px 8px", borderRadius:6, border:"1px solid #e5e7eb" }}>🎨 {c}</span>)}
                  </div>
                )}
              </div>
              {isAdmin && (
                <button
                  className="btn btn-primary"
                  onClick={() => { setActiveTab("inventory"); setInventoryNav({ type:"edit", productId: selected.id }); }}
                  style={{ flexShrink:0 }}>
                  ✏️ Edit in Inventory
                </button>
              )}
            </div>
          </div>

          {/* Pricing + Stock grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:14 }}>
            {/* Selling Price */}
            <div className="card" style={{ textAlign:"center", padding:"16px 12px" }}>
              <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>💰 Selling Price</div>
              {stats.isSV ? (
                <div>
                  {[...new Set((selected.sizeVariants||[]).map(sv=>sv.sellingPrice).filter(Boolean))].length > 1 ? (
                    <div style={{ fontSize:14, fontWeight:800, color:"#7c3aed" }}>
                      ₹{Math.min(...(selected.sizeVariants||[]).map(sv=>sv.sellingPrice||0).filter(Boolean))}–₹{Math.max(...(selected.sizeVariants||[]).map(sv=>sv.sellingPrice||0).filter(Boolean))}
                    </div>
                  ) : <div style={{ fontSize:18, fontWeight:800, color:"#7c3aed" }}>₹{stats.sellingPrice}</div>}
                  <div style={{ fontSize:10, color:"#9ca3af" }}>size-wise</div>
                </div>
              ) : <div style={{ fontSize:20, fontWeight:800, color:"#7c3aed" }}>₹{stats.sellingPrice}</div>}
            </div>

            {/* Purchase Price — admin only */}
            {isAdmin && (
              <div className="card" style={{ textAlign:"center", padding:"16px 12px" }}>
                <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>🛒 Purchase Price</div>
                {stats.purchasePrice > 0
                  ? <div style={{ fontSize:20, fontWeight:800, color:"#dc2626" }}>₹{stats.isSV ? `~${stats.purchasePrice}` : stats.purchasePrice}</div>
                  : <div style={{ fontSize:14, color:"#9ca3af" }}>Not set</div>}
                {stats.isSV && <div style={{ fontSize:10, color:"#9ca3af" }}>avg</div>}
              </div>
            )}

            {/* MRP */}
            {(stats.mrp > 0 || stats.isSV) && (
              <div className="card" style={{ textAlign:"center", padding:"16px 12px" }}>
                <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>🏷️ MRP</div>
                {stats.mrp > 0
                  ? <div style={{ fontSize:20, fontWeight:800, color:"#d97706" }}>₹{stats.mrp}</div>
                  : <div style={{ fontSize:14, color:"#9ca3af" }}>—</div>}
              </div>
            )}

            {/* Margin — admin only */}
            {isAdmin && (
              <div className="card" style={{ textAlign:"center", padding:"16px 12px" }}>
                <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>📈 Margin %</div>
                {stats.margin !== null
                  ? <div style={{ fontSize:20, fontWeight:800, color:marginColor(stats.margin) }}>{stats.margin}%</div>
                  : <div style={{ fontSize:13, color:"#9ca3af" }}>Need cost</div>}
              </div>
            )}

            {/* Stock */}
            <div className="card" style={{ textAlign:"center", padding:"16px 12px",
              background: stats.stockStatus==="ok"?"#f0fdf4":stats.stockStatus==="low"?"#fffbeb":"#fef2f2" }}>
              <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>📦 Stock</div>
              <div style={{ fontSize:20, fontWeight:800,
                color: stats.stockStatus==="ok"?"#059669":stats.stockStatus==="low"?"#d97706":"#dc2626" }}>
                {stats.stock}
              </div>
              <div style={{ fontSize:10, fontWeight:700,
                color: stats.stockStatus==="ok"?"#059669":stats.stockStatus==="low"?"#d97706":"#dc2626" }}>
                {stats.stockStatus==="ok"?"In Stock":stats.stockStatus==="low"?"Low Stock ⚠️":"Out of Stock ❌"}
              </div>
            </div>

            {/* Total Sold */}
            <div className="card" style={{ textAlign:"center", padding:"16px 12px" }}>
              <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>🛍️ Total Sold</div>
              <div style={{ fontSize:20, fontWeight:800, color:"#2563eb" }}>{stats.totalQtySold}</div>
              <div style={{ fontSize:10, color:"#9ca3af" }}>{stats.pSales.length} bills</div>
            </div>
          </div>

          {/* Admin analytics row */}
          {isAdmin && stats.totalQtySold > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:14 }}>
              <div className="card" style={{ textAlign:"center", padding:"14px 12px" }}>
                <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>💵 Total Revenue</div>
                <div style={{ fontSize:18, fontWeight:800, color:"#059669" }}>₹{stats.totalRevenue.toLocaleString()}</div>
              </div>
              {stats.totalCost > 0 && <>
                <div className="card" style={{ textAlign:"center", padding:"14px 12px" }}>
                  <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>🏷️ Total Cost</div>
                  <div style={{ fontSize:18, fontWeight:800, color:"#dc2626" }}>₹{stats.totalCost.toLocaleString()}</div>
                </div>
                <div className="card" style={{ textAlign:"center", padding:"14px 12px" }}>
                  <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>💰 Total Profit</div>
                  <div style={{ fontSize:18, fontWeight:800, color:marginColor(stats.totalMarginPct) }}>₹{stats.totalMargin.toLocaleString()}</div>
                  {stats.totalMarginPct !== null && <div style={{ fontSize:11, fontWeight:700, color:marginColor(stats.totalMarginPct) }}>{stats.totalMarginPct}%</div>}
                </div>
              </>}
              {stats.daysSinceLastSale !== null && (
                <div className="card" style={{ textAlign:"center", padding:"14px 12px" }}>
                  <div style={{ fontSize:11, color:"#9ca3af", fontWeight:600, marginBottom:4 }}>🕐 Last Sale</div>
                  <div style={{ fontSize:16, fontWeight:800, color: stats.daysSinceLastSale <= 7 ? "#059669" : stats.daysSinceLastSale <= 30 ? "#d97706" : "#dc2626" }}>
                    {stats.daysSinceLastSale === 0 ? "Aaj" : `${stats.daysSinceLastSale}d ago`}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Size-variant table */}
          {stats.isSV && selected.sizeVariants?.length > 0 && (
            <div className="card" style={{ marginBottom:14, padding:0, overflow:"hidden" }}>
              <div style={{ padding:"10px 14px", background:"#f9fafb", fontWeight:700, fontSize:12, color:"#374151", borderBottom:"1px solid #f3f4f6" }}>
                📐 Size-wise Pricing & Stock
              </div>
              <div style={{ overflowX:"auto" }}>
                <table className="table" style={{ minWidth:420 }}>
                  <thead><tr>
                    <th>Size</th>
                    <th style={{ textAlign:"right" }}>Sell Price</th>
                    {isAdmin && <th style={{ textAlign:"right" }}>Purchase</th>}
                    {isAdmin && <th style={{ textAlign:"right" }}>MRP</th>}
                    {isAdmin && <th style={{ textAlign:"right" }}>Margin</th>}
                    <th style={{ textAlign:"right" }}>Stock</th>
                    <th style={{ textAlign:"right" }}>Sold</th>
                  </tr></thead>
                  <tbody>
                    {selected.sizeVariants.map((sv, i) => {
                      const svMargin = sv.sellingPrice > 0 && sv.purchasePrice > 0
                        ? Math.round(((sv.sellingPrice - sv.purchasePrice) / sv.sellingPrice) * 100) : null;
                      const svSold = stats.sizeBreakdown[sv.size]?.qty || 0;
                      const svStock = sv.stock || 0;
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight:700 }}>{sv.size}</td>
                          <td style={{ textAlign:"right", fontWeight:700, color:"#7c3aed" }}>₹{sv.sellingPrice||"—"}</td>
                          {isAdmin && <td style={{ textAlign:"right", color:"#dc2626" }}>₹{sv.purchasePrice||"—"}</td>}
                          {isAdmin && <td style={{ textAlign:"right", color:"#d97706" }}>{sv.mrp||sv.mrpPerPiece?"₹"+(sv.mrp||sv.mrpPerPiece):"—"}</td>}
                          {isAdmin && <td style={{ textAlign:"right" }}>
                            {svMargin !== null
                              ? <span style={{ fontWeight:700, color:marginColor(svMargin) }}>{svMargin}%</span>
                              : <span style={{ color:"#d1d5db" }}>—</span>}
                          </td>}
                          <td style={{ textAlign:"right" }}>
                            <span style={{ fontWeight:700, color:svStock===0?"#dc2626":svStock<=5?"#d97706":"#059669" }}>{svStock}</span>
                          </td>
                          <td style={{ textAlign:"right", color:"#6b7280" }}>{svSold || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Size + Color breakdown */}
          {(Object.keys(stats.sizeBreakdown).length > 0 || Object.keys(stats.colorBreakdown).length > 0) && (
            <div className="grid-2col" style={{ marginBottom:14 }}>
              {Object.keys(stats.sizeBreakdown).length > 0 && (
                <div className="card">
                  <h4 style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>📐 Size-wise Sales</h4>
                  {Object.entries(stats.sizeBreakdown).sort((a,b)=>b[1].qty-a[1].qty).map(([size, data]) => {
                    const pct = stats.totalQtySold > 0 ? Math.round(data.qty/stats.totalQtySold*100) : 0;
                    return (
                      <div key={size} style={{ marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                          <span style={{ fontSize:12, fontWeight:700 }}>Size {size}</span>
                          <span style={{ fontSize:11, color:"#9ca3af" }}>{data.qty} pcs ({pct}%)</span>
                        </div>
                        <div style={{ background:"#f3f4f6", borderRadius:6, height:6 }}>
                          <div style={{ width:`${pct}%`, height:"100%", background:"#7c3aed", borderRadius:6, transition:"width 0.5s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {Object.keys(stats.colorBreakdown).length > 0 && (
                <div className="card">
                  <h4 style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>🎨 Color-wise Sales</h4>
                  {Object.entries(stats.colorBreakdown).sort((a,b)=>b[1]-a[1]).map(([color, qty]) => {
                    const pct = stats.totalQtySold > 0 ? Math.round(qty/stats.totalQtySold*100) : 0;
                    return (
                      <div key={color} style={{ marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                          <span style={{ fontSize:12, fontWeight:700 }}>{color}</span>
                          <span style={{ fontSize:11, color:"#9ca3af" }}>{qty} pcs ({pct}%)</span>
                        </div>
                        <div style={{ background:"#f3f4f6", borderRadius:6, height:6 }}>
                          <div style={{ width:`${pct}%`, height:"100%", background:"#059669", borderRadius:6 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Monthly trend */}
          {trendMonths.length > 0 && (
            <div className="card" style={{ marginBottom:14 }}>
              <h4 style={{ fontWeight:700, fontSize:13, marginBottom:14 }}>📅 Monthly Sales Trend (Last 6 months)</h4>
              <div style={{ display:"flex", alignItems:"flex-end", gap:10, height:90 }}>
                {trendMonths.map(([month, data]) => {
                  const h = Math.max(Math.round((data.qty / maxTrendQty) * 80), data.qty > 0 ? 8 : 3);
                  const label = new Date(month+"-01").toLocaleDateString("en-IN",{month:"short", year:"2-digit"});
                  return (
                    <div key={month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                      <div style={{ fontSize:10, color:"#9ca3af", fontWeight:600 }}>{data.qty}</div>
                      <div title={`${label}: ${data.qty} pcs, ₹${data.revenue.toLocaleString()}`}
                        style={{ width:"100%", background:"linear-gradient(to top,#7c3aed,#a855f7)", borderRadius:"4px 4px 0 0", height:`${h}px`, minHeight:3, cursor:"default" }} />
                      <div style={{ fontSize:10, color:"#6b7280", fontWeight:500, textAlign:"center" }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Purchase history */}
          {isAdmin && stats.pPurchases.length > 0 && (
            <div className="card" style={{ marginBottom:14, padding:0, overflow:"hidden" }}>
              <div style={{ padding:"10px 14px", background:"#fef3c7", fontWeight:700, fontSize:12, color:"#92400e", borderBottom:"1px solid #fde68a", display:"flex", justifyContent:"space-between" }}>
                <span>🛒 Purchase History</span>
                <span style={{ fontWeight:600 }}>Total purchased: {stats.totalPurchased} pcs</span>
              </div>
              <table className="table">
                <thead><tr><th>Date</th><th>Supplier</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
                <tbody>
                  {[...stats.pPurchases].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).map((pu,i)=>(
                    <tr key={i}>
                      <td style={{ color:"#6b7280" }}>{pu.date||"—"}</td>
                      <td>{pu.supplier||"—"}</td>
                      <td style={{ fontWeight:700 }}>{pu.quantity}</td>
                      <td style={{ color:"#dc2626" }}>₹{pu.purchasePrice||"—"}</td>
                      <td style={{ fontWeight:700 }}>₹{(pu.total||(pu.purchasePrice*pu.quantity)||0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* No sales yet message */}
          {stats.totalQtySold === 0 && (
            <div className="card" style={{ textAlign:"center", padding:"20px 16px", background:"#f9fafb" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>📊</div>
              <p style={{ color:"#9ca3af", fontSize:13 }}>Abhi tak is product ka koi sale nahi hai</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================
// ============================================================
// WHATSAPP BROADCAST
// ============================================================
const WhatsAppBroadcast = ({ customers, sales, shopName, showToast }) => {
  const [tab, setTab]               = useState("active");
  const [sortBy, setSortBy]         = useState("alpha");   // "alpha" | "phone" | "recent" | "lastSent"
  const [filterType, setFilterType] = useState("all");     // all | region | selected
  const [region, setRegion]         = useState("local");
  const [selected, setSelected]     = useState({});
  const [msgTemplate, setMsgTemplate] = useState("sale");
  const [customMsg, setCustomMsg]   = useState("");
  const [sending, setSending]       = useState(false);
  const [sentCount, setSentCount]   = useState(0);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [copied, setCopied]         = useState(false);
  const [sessionSent, setSessionSent] = useState({}); // phone -> true, for this session's green tick

  // noWA: phone -> true = no WhatsApp
  const [noWA, setNoWA] = useState(() => {
    try { return JSON.parse(localStorage.getItem("noWhatsApp") || "{}"); } catch { return {}; }
  });
  // BUG52 FIX: sentLog ab Firebase mein store hota hai — sab devices pe sync
  // Pehle localStorage mein tha — dusre device pe same customer ko phir send hota tha
  const [sentLog, setSentLogState] = useState(() => {
    try { return JSON.parse(localStorage.getItem("waSentLog") || "{}"); } catch { return {}; }
  });
  // Load from Firebase on mount
  React.useEffect(() => {
    const ref = doc(db, "meta", "waSentLog");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const data = snap.data().log || {};
        setSentLogState(data);
        try { localStorage.setItem("waSentLog", JSON.stringify(data)); } catch {}
      }
    });
    return () => unsub();
  }, []);
  const setSentLog = (updated) => {
    setSentLogState(updated);
    try { localStorage.setItem("waSentLog", JSON.stringify(updated)); } catch {}
    // BUG52 FIX: Firebase pe save karo
    setDoc(doc(db, "meta", "waSentLog"), { log: updated }).catch(console.error);
  };

  const saveNoWA = (u) => { setNoWA(u); try { localStorage.setItem("noWhatsApp", JSON.stringify(u)); } catch {} };
  const markNoWA   = (phone) => saveNoWA({ ...noWA, [phone]: true });
  const markActive = (phone) => { const u = { ...noWA }; delete u[phone]; saveNoWA(u); };

  const recordSent = (phones) => {
    const now = new Date().toISOString();
    const updated = { ...sentLog };
    phones.forEach(p => { updated[p] = { ts: now, count: (updated[p]?.count || 0) + 1 }; });
    setSentLog(updated); // BUG52: setSentLog already handles localStorage + Firebase
  };

  const fmtSentTime = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }) +
           ", " + d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });
  };

  const getCustomerSales = (phone) => sales.filter(s => s.phone === phone);

  const templates = {
    sale:     (c) => `*${shopName}* - Special Offer!\n\nHello ${c.name},\n\nWe have amazing deals for you today! Visit us for upto 20% OFF on new arrivals.\n\nCome visit ${shopName}!\n\n_Thank you for your support_`,
    followup: (c) => { const last = getCustomerSales(c.phone)[0]; return `*${shopName}* - We Miss You!\n\nHello ${c.name},\n\nIt's been a while! Your last purchase was Rs.${last?.total || 0}. Thank you!\n\nNew stock has arrived — come check it out!\n\n${shopName}`; },
    festive:  (c) => `*${shopName}* - Festival Greetings!\n\nDear ${c.name},\n\nWishing you and your family a wonderful celebration!\n\nSpecial festive collection now available:\n- Special discounts\n- New designs\n- Limited stock\n\nVisit us soon!\n\n${shopName}`,
    custom:   (c) => customMsg.replace(/\{naam\}/g, c.name).replace(/\{name\}/g, c.name).replace(/\{shop\}/g, shopName),
  };
  const getMsg = (c) => (templates[msgTemplate] || templates.custom)(c);

  const allWithPhone = customers.filter(c => c.phone && c.phone.replace(/\D/g,"").length >= 10);
  const activeList   = allWithPhone.filter(c => !noWA[c.phone]);
  const inactiveList = allWithPhone.filter(c =>  noWA[c.phone]);

  // Sorting
  const sortList = (list) => {
    const copy = [...list];
    if (sortBy === "alpha")    return copy.sort((a,b) => a.name.localeCompare(b.name));
    if (sortBy === "phone")    return copy.sort((a,b) => a.phone.replace(/\D/g,"").localeCompare(b.phone.replace(/\D/g,"")));
    if (sortBy === "recent")   return copy.sort((a,b) => {
      const sa = getCustomerSales(a.phone)[0]; const sb = getCustomerSales(b.phone)[0];
      return (sb?.id||0) - (sa?.id||0);
    });
    if (sortBy === "lastSent") return copy.sort((a,b) => {
      const ta = sentLog[a.phone]?.ts || ""; const tb = sentLog[b.phone]?.ts || "";
      return ta.localeCompare(tb); // oldest first so you know who hasn't been sent
    });
    return copy;
  };

  const applyFilter = (list) => {
    if (filterType === "region")   return list.filter(c => c.region === region);
    if (filterType === "selected") return list.filter(c => selected[c.phone]);
    return list;
  };

  const sortedActive   = sortList(activeList);
  const sortedInactive = sortList(inactiveList);
  const displayList    = tab === "active" ? sortedActive : sortedInactive;
  const recipients     = applyFilter(sortedActive);

  const toggleSelect = (phone) => setSelected(p => ({ ...p, [phone]: !p[phone] }));
  const selectAll    = () => { const s = {}; activeList.forEach(c => s[c.phone] = true); setSelected(s); };
  const clearAll     = () => setSelected({});

  const openWA = (c) => {
    const phone = c.phone.replace(/\D/g, "");
    const num   = phone.length === 10 ? `91${phone}` : phone;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(getMsg(c))}`, "_blank");
    recordSent([c.phone]);
    setSessionSent(p => ({ ...p, [c.phone]: true }));
  };

  const sendBroadcast = async () => {
    if (recipients.length === 0) { showToast("No recipients selected!", "error"); return; }
    if (!window.confirm(`Open WhatsApp for ${recipients.length} contacts one by one?\n\nIf any number shows "not on WhatsApp" — come back and click No WA.`)) return;
    setSending(true); setSentCount(0); setCurrentIdx(0);
    const phones = [];
    for (let i = 0; i < recipients.length; i++) {
      setCurrentIdx(i);
      const c = recipients[i];
      const phone = c.phone.replace(/\D/g, "");
      const num   = phone.length === 10 ? `91${phone}` : phone;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(getMsg(c))}`, "_blank");
      phones.push(c.phone);
      setSessionSent(p => ({ ...p, [c.phone]: true }));
      setSentCount(i + 1);
      await new Promise(r => setTimeout(r, 2000));
    }
    recordSent(phones);
    setSending(false); setCurrentIdx(-1);
    showToast(`Opened WhatsApp for ${recipients.length} contacts!`);
  };

  const copyAllMessages = () => {
    const text = recipients.map((c,i) => `--- ${i+1}. ${c.name} (${c.phone}) ---\n${getMsg(c)}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2500);
      recordSent(recipients.map(c => c.phone));
      showToast("All messages copied!");
    });
  };

  const exportCSV = () => {
    const rows = [["#","Name","Phone","Region","Visits","Last Purchase","Last WA Sent"]];
    sortedActive.forEach((c,i) => {
      const cSales = getCustomerSales(c.phone);
      rows.push([i+1, c.name, c.phone, c.region||"", cSales.length, cSales[0]?.total||"", fmtSentTime(sentLog[c.phone]?.ts)||"Never"]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv," + encodeURIComponent(csv);
    a.download = `${shopName}_WA_Contacts.csv`; a.click();
    showToast("CSV downloaded!");
  };

  // Alphabet index — unique first letters for quick jump
  const alphaIndex = sortBy === "alpha"
    ? [...new Set(displayList.map(c => c.name[0]?.toUpperCase()).filter(Boolean))]
    : sortBy === "phone"
    ? [...new Set(displayList.map(c => c.phone.replace(/\D/g,"")[0]).filter(Boolean))]
    : [];

  const scrollToLetter = (letter) => {
    const el = document.getElementById(`wa-group-${letter}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Group list by first letter (only for alpha/phone sort)
  const grouped = (sortBy === "alpha" || sortBy === "phone")
    ? displayList.reduce((acc, c) => {
        const key = sortBy === "alpha"
          ? (c.name[0]?.toUpperCase() || "#")
          : (c.phone.replace(/\D/g,"")[0] || "#");
        if (!acc[key]) acc[key] = [];
        acc[key].push(c);
        return acc;
      }, {})
    : null;

  const totalSentToday = Object.values(sentLog).filter(v => {
    if (!v?.ts) return false;
    return v.ts.slice(0,10) === new Date().toISOString().slice(0,10);
  }).length;

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:10 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, color:"#111827", marginBottom:3 }}>WhatsApp Broadcast</h2>
          <p style={{ fontSize:13, color:"#9ca3af" }}>Send messages to customers — track who was sent</p>
        </div>
        {totalSentToday > 0 && (
          <div style={{ background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:10, padding:"8px 14px", fontSize:12, color:"#059669", fontWeight:700 }}>
            {totalSentToday} sent today
          </div>
        )}
      </div>

      {/* Stats Bar */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 }}>
        {[
          { label:"Active on WA",    value:activeList.length,   color:"#25d366", bg:"#f0fdf4",  border:"#86efac" },
          { label:"No WhatsApp",     value:inactiveList.length, color:"#dc2626", bg:"#fef2f2",  border:"#fca5a5" },
          { label:"Sent This Week",  value:Object.values(sentLog).filter(v=>v?.ts && v.ts >= new Date(Date.now()-7*86400000).toISOString()).length, color:"#7c3aed", bg:"#f5f3ff", border:"#c4b5fd" },
          { label:"Never Sent",      value:activeList.filter(c=>!sentLog[c.phone]).length, color:"#f59e0b", bg:"#fffbeb", border:"#fde68a" },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, border:`1.5px solid ${s.border}`, borderRadius:12, padding:"10px 14px" }}>
            <div style={{ fontSize:20, fontWeight:800, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:11, color:"#6b7280", marginTop:1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 350px", gap:18, alignItems:"start" }}>

        {/* LEFT */}
        <div>
          {/* Tab + Sort row */}
          <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center", flexWrap:"wrap" }}>
            {/* Tabs */}
            <div style={{ display:"flex", background:"#f3f4f6", borderRadius:10, padding:3, flex:"none" }}>
              {[
                { v:"active",   l:`Active (${activeList.length})`,   col:"#25d366" },
                { v:"inactive", l:`No WA (${inactiveList.length})`,  col:"#dc2626" },
              ].map(t => (
                <button key={t.v} onClick={() => setTab(t.v)}
                  style={{ padding:"6px 14px", borderRadius:8, border:"none", fontWeight:700, fontSize:12, cursor:"pointer",
                    background: tab===t.v?"white":"transparent", color:tab===t.v?t.col:"#9ca3af",
                    boxShadow: tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none" }}>
                  {t.l}
                </button>
              ))}
            </div>

            {/* Sort buttons */}
            <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
              <span style={{ fontSize:11, color:"#9ca3af", alignSelf:"center", marginRight:2 }}>Sort:</span>
              {[
                { v:"alpha",    l:"A–Z"         },
                { v:"phone",    l:"0–9"         },
                { v:"recent",   l:"Recent"      },
                { v:"lastSent", l:"Oldest Sent" },
              ].map(s => (
                <button key={s.v} onClick={() => setSortBy(s.v)}
                  style={{ padding:"5px 10px", borderRadius:7, border:`1.5px solid ${sortBy===s.v?"#7c3aed":"#e5e7eb"}`,
                    background:sortBy===s.v?"#f5f3ff":"white", color:sortBy===s.v?"#7c3aed":"#6b7280",
                    fontWeight:700, fontSize:11, cursor:"pointer" }}>
                  {s.l}
                </button>
              ))}
            </div>
          </div>

          {/* Filter row — active tab only */}
          {tab === "active" && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:12 }}>
              {[
                { v:"all",      l:"All",      count:activeList.length },
                { v:"region",   l:"Region",   count:activeList.filter(c=>c.region===region).length },
                { v:"selected", l:"Selected", count:Object.values(selected).filter(Boolean).length },
              ].map(({ v,l,count }) => (
                <button key={v} onClick={() => setFilterType(v)}
                  style={{ padding:"4px 11px", borderRadius:7, border:`2px solid ${filterType===v?"#25d366":"#e5e7eb"}`,
                    background:filterType===v?"#f0fdf4":"white", color:filterType===v?"#059669":"#6b7280",
                    fontWeight:700, cursor:"pointer", fontSize:11 }}>
                  {l} <span style={{ background:filterType===v?"#dcfce7":"#f3f4f6", color:filterType===v?"#059669":"#9ca3af", borderRadius:5, padding:"1px 5px", fontSize:10 }}>{count}</span>
                </button>
              ))}
              {filterType === "region" && ["local","out-city","out-state"].map(rv => (
                <button key={rv} onClick={() => setRegion(rv)}
                  style={{ padding:"4px 10px", borderRadius:7, border:`1.5px solid ${region===rv?"#7c3aed":"#e5e7eb"}`,
                    background:region===rv?"#f5f3ff":"white", color:region===rv?"#7c3aed":"#6b7280", fontWeight:600, cursor:"pointer", fontSize:11 }}>
                  {rv}
                </button>
              ))}
              {filterType === "selected" && (
                <>
                  <button onClick={selectAll} style={{ fontSize:11, color:"#7c3aed", fontWeight:700, background:"none", border:"none", cursor:"pointer" }}>Select All</button>
                  <button onClick={clearAll}  style={{ fontSize:11, color:"#9ca3af", fontWeight:700, background:"none", border:"none", cursor:"pointer" }}>Clear</button>
                </>
              )}
            </div>
          )}

          {/* Alphabet / Number quick-jump bar */}
          {alphaIndex.length > 1 && (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10, padding:"6px 10px", background:"#f9fafb", borderRadius:8 }}>
              <span style={{ fontSize:10, color:"#9ca3af", alignSelf:"center", marginRight:4 }}>Jump:</span>
              {alphaIndex.sort().map(l => (
                <button key={l} onClick={() => scrollToLetter(l)}
                  style={{ width:24, height:24, borderRadius:6, border:"1px solid #e5e7eb", background:"white",
                    color:"#374151", fontWeight:700, fontSize:11, cursor:"pointer", padding:0 }}>
                  {l}
                </button>
              ))}
            </div>
          )}

          {/* Contact List */}
          <div className="card" style={{ padding:0, overflow:"hidden" }}>
            <div style={{ padding:"9px 16px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", background:tab==="active"?"#f0fdf4":"#fef2f2" }}>
              <span style={{ fontWeight:700, fontSize:12, color:tab==="active"?"#059669":"#dc2626" }}>
                {tab==="active" ? `${displayList.length} active` : `${displayList.length} no WhatsApp`}
                {tab==="active" && sentCount>0 && ` — ${sentCount} opened this session`}
              </span>
              {tab==="inactive" && displayList.length>0 && (
                <button onClick={() => { if(window.confirm(`Restore all ${displayList.length} contacts?`)) displayList.forEach(c=>markActive(c.phone)); }}
                  style={{ fontSize:11, color:"#059669", fontWeight:700, background:"none", border:"none", cursor:"pointer" }}>Restore All</button>
              )}
            </div>

            <div style={{ maxHeight:520, overflowY:"auto" }} id="wa-list-scroll">
              {displayList.length === 0 && (
                <div style={{ padding:40, textAlign:"center", color:"#9ca3af" }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>{tab==="active"?"📱":"✅"}</div>
                  <p style={{ fontSize:13 }}>{tab==="active"?"No active contacts":"No inactive contacts"}</p>
                </div>
              )}

              {/* Grouped (alpha/phone sort) */}
              {grouped && Object.keys(grouped).sort().map(letter => (
                <div key={letter} id={`wa-group-${letter}`}>
                  <div style={{ padding:"4px 16px", background:"#f9fafb", borderBottom:"1px solid #f3f4f6",
                    fontSize:11, fontWeight:800, color:"#9ca3af", letterSpacing:1 }}>
                    {letter} — {grouped[letter].length} contact{grouped[letter].length>1?"s":""}
                  </div>
                  {grouped[letter].map((c,i) => <ContactRow key={c.phone} c={c} i={i} />)}
                </div>
              ))}

              {/* Flat list (recent/lastSent sort) */}
              {!grouped && displayList.map((c,i) => <ContactRow key={c.phone} c={c} i={i} />)}
            </div>
          </div>

          <div style={{ marginTop:10, background:"#fffbeb", border:"1px solid #fde68a", borderRadius:9, padding:"9px 13px", fontSize:11, color:"#92400e", lineHeight:1.7 }}>
            <b>How to identify No-WA numbers:</b> Click <b>Send</b> → WhatsApp opens → if it says "not on WhatsApp" → come back → click <b>No WA</b> → auto-skipped in future
          </div>
        </div>

        {/* RIGHT: Template + Actions */}
        <div style={{ position:"sticky", top:80, display:"flex", flexDirection:"column", gap:12 }}>

          {/* Broadcast progress — show how many done this session */}
          {(tab==="active" && recipients.length>0) && (
            <div style={{ background:"white", border:"1.5px solid #e5e7eb", borderRadius:12, padding:"10px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>Session Progress</span>
                <span style={{ fontSize:11, color:"#9ca3af" }}>{Object.values(sessionSent).filter(Boolean).length} / {recipients.length}</span>
              </div>
              <div style={{ background:"#f3f4f6", borderRadius:6, height:7, overflow:"hidden" }}>
                <div style={{ background:"#25d366", height:"100%",
                  width:`${(Object.values(sessionSent).filter(Boolean).length / Math.max(recipients.length,1))*100}%`,
                  transition:"width 0.4s", borderRadius:6 }} />
              </div>
              <div style={{ fontSize:10, color:"#9ca3af", marginTop:5 }}>
                {recipients.filter(c=>!sessionSent[c.phone]).length} remaining in this session
              </div>
            </div>
          )}

          {/* Template */}
          <div className="card">
            <h3 style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Message Template</h3>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {[
                { v:"sale",     l:"Sale Offer",     sub:"Discounts & offers" },
                { v:"followup", l:"Follow-up",      sub:"Re-engage customers" },
                { v:"festive",  l:"Festive Wishes", sub:"Festival greetings" },
                { v:"custom",   l:"Custom",         sub:"Write your own" },
              ].map(({ v,l,sub }) => (
                <label key={v} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, cursor:"pointer",
                  border:`1.5px solid ${msgTemplate===v?"#25d366":"#e5e7eb"}`, background:msgTemplate===v?"#f0fdf4":"white" }}>
                  <input type="radio" name="tmpl" checked={msgTemplate===v} onChange={() => setMsgTemplate(v)} style={{ accentColor:"#25d366" }} />
                  <div>
                    <div style={{ fontWeight:700, fontSize:12, color:msgTemplate===v?"#059669":"#374151" }}>{l}</div>
                    <div style={{ fontSize:10, color:"#9ca3af" }}>{sub}</div>
                  </div>
                </label>
              ))}
            </div>
            {msgTemplate==="custom" && (
              <textarea className="input" rows={3} value={customMsg} onChange={e=>setCustomMsg(e.target.value)}
                placeholder="Hello {name}! Visit {shop}..."
                style={{ resize:"vertical", fontSize:12, marginTop:8 }} />
            )}
          </div>

          {/* Preview */}
          {recipients.length>0 && (
            <div className="card" style={{ background:"#f0fdf4", border:"1.5px solid #86efac", padding:"10px 12px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:11, fontWeight:700, color:"#059669" }}>Preview</span>
                <span style={{ fontSize:10, color:"#9ca3af" }}>{recipients[0].name}</span>
              </div>
              <div style={{ background:"white", borderRadius:8, padding:"8px 10px", fontSize:11, whiteSpace:"pre-wrap", color:"#374151", lineHeight:1.5, maxHeight:120, overflowY:"auto" }}>
                {getMsg(recipients[0])}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="card" style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2 }}>
              <span style={{ fontWeight:700, fontSize:13 }}>{recipients.length} to send</span>
              {inactiveList.length>0 && <span style={{ fontSize:11, color:"#dc2626", fontWeight:600 }}>{inactiveList.length} skipped (No WA)</span>}
            </div>

            {sending ? (
              <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:14, textAlign:"center" }}>
                <div style={{ fontWeight:800, color:"#059669", fontSize:15, marginBottom:6 }}>{sentCount} / {recipients.length}</div>
                {currentIdx>=0 && <div style={{ fontSize:12, color:"#374151", marginBottom:8 }}>Current: <b>{recipients[currentIdx]?.name}</b></div>}
                <div style={{ background:"#e5e7eb", borderRadius:6, height:6, overflow:"hidden" }}>
                  <div style={{ background:"#25d366", height:"100%", width:`${(sentCount/recipients.length)*100}%`, transition:"width 0.4s" }} />
                </div>
                <p style={{ fontSize:10, color:"#9ca3af", marginTop:6 }}>Each window opens → send → come back</p>
                <p style={{ fontSize:10, color:"#f59e0b", marginTop:2 }}>If "not on WhatsApp" appears → click No WA</p>
              </div>
            ) : (
              <>
                <button onClick={sendBroadcast} disabled={recipients.length===0}
                  style={{ width:"100%", padding:"11px", border:"none", borderRadius:10, fontWeight:800, fontSize:13, cursor:recipients.length>0?"pointer":"not-allowed",
                    background:recipients.length>0?"linear-gradient(135deg,#25d366,#128c7e)":"#e5e7eb", color:recipients.length>0?"white":"#9ca3af",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <WAIcon size={17}/> Open WA for Each ({recipients.length})
                </button>
                <button onClick={copyAllMessages} disabled={recipients.length===0}
                  style={{ width:"100%", padding:"9px", border:`1.5px solid ${copied?"#86efac":"#e5e7eb"}`, borderRadius:10, fontWeight:700, fontSize:12,
                    background:copied?"#f0fdf4":"white", color:copied?"#059669":"#374151", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  {copied?"✓ Copied!":"Copy All Messages"}
                </button>
                <button onClick={exportCSV}
                  style={{ width:"100%", padding:"9px", border:"1.5px solid #e5e7eb", borderRadius:10, fontWeight:700, fontSize:12,
                    background:"white", color:"#374151", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  Export Contacts CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Inner component for contact row
  function ContactRow({ c, i }) {
    const cSales   = getCustomerSales(c.phone);
    const isActive = !noWA[c.phone];
    const isSel    = !!selected[c.phone];
    const wasSent  = !!sessionSent[c.phone];
    const logEntry = sentLog[c.phone];
    const serialNo = displayList.indexOf(c) + 1;

    return (
      <div style={{ display:"flex", alignItems:"center", gap:9, padding:"9px 14px", borderBottom:"1px solid #f9fafb",
        background: wasSent ? "#f0fdf4" : isSel ? "#fafffe" : "white" }}>
        {/* Serial number */}
        <div style={{ width:22, textAlign:"right", fontSize:11, color:"#d1d5db", fontWeight:700, flexShrink:0 }}>{serialNo}</div>

        {/* Checkbox for selected filter */}
        {filterType==="selected" && tab==="active" && (
          <input type="checkbox" checked={isSel} onChange={() => toggleSelect(c.phone)}
            style={{ width:14, height:14, accentColor:"#25d366", cursor:"pointer", flexShrink:0 }} />
        )}

        {/* Status dot */}
        <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
          background: wasSent ? "#25d366" : isActive ? "#d1fae5" : "#ef4444",
          border: wasSent ? "2px solid #16a34a" : isActive ? "2px solid #6ee7b7" : "2px solid #fca5a5" }} />

        {/* Info */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:13, color:"#111827", display:"flex", alignItems:"center", gap:5 }}>
            {c.name}
            {wasSent && <span style={{ fontSize:9, background:"#dcfce7", color:"#16a34a", borderRadius:5, padding:"1px 5px", fontWeight:700 }}>Sent ✓</span>}
          </div>
          <div style={{ fontSize:10, color:"#9ca3af", display:"flex", gap:6, flexWrap:"wrap" }}>
            <span>{c.phone}</span>
            {c.region && <span>• {c.region}</span>}
            <span>• {cSales.length} visits</span>
            {logEntry?.ts && (
              <span style={{ color:"#7c3aed" }}>• Last sent: {fmtSentTime(logEntry.ts)}</span>
            )}
            {!logEntry && isActive && (
              <span style={{ color:"#f59e0b" }}>• Never sent</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display:"flex", gap:4, flexShrink:0 }}>
          {isActive ? (
            <>
              <button onClick={() => openWA(c)}
                style={{ padding:"4px 9px", background:wasSent?"#dcfce7":"#f0fdf4", border:`1px solid ${wasSent?"#86efac":"#bbf7d0"}`,
                  borderRadius:7, color:"#059669", fontWeight:700, fontSize:11, cursor:"pointer" }}>
                {wasSent ? "Resend" : "Send"}
              </button>
              <button onClick={() => markNoWA(c.phone)}
                style={{ padding:"4px 8px", background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:7, color:"#dc2626", fontWeight:700, fontSize:11, cursor:"pointer" }}>
                No WA
              </button>
            </>
          ) : (
            <button onClick={() => markActive(c.phone)}
              style={{ padding:"4px 9px", background:"#f0fdf4", border:"1px solid #86efac", borderRadius:7, color:"#059669", fontWeight:700, fontSize:11, cursor:"pointer" }}>
              Restore
            </button>
          )}
        </div>
      </div>
    );
  }
};



// ============================================================
// SETTINGS (with Backup/Restore)
// ============================================================
const Settings = ({ shopName, setShopName, showToast, sales, products, purchases, customers, billCounter, setSales, setProducts, setPurchases, setCustomers, setBillCounter, customSizes, setCustomSizes }) => {
  const [name, setName] = useState(shopName);
  const [address, setAddress] = useState(() => {
    try { return localStorage.getItem('shopAddress') || "Shop No:1, Bhagwant Complex, Pande Chowk, Barshi"; } catch { return "Shop No:1, Bhagwant Complex, Pande Chowk, Barshi"; }
  });
  const [phone, setPhone] = useState(() => {
    try { return localStorage.getItem('shopPhone') || ""; } catch { return ""; }
  });
  const [gst, setGst] = useState(() => {
    try { return localStorage.getItem('shopGst') || ""; } catch { return ""; }
  });
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [restoreStatus, setRestoreStatus] = useState(null);
  const [newSizeInput, setNewSizeInput] = useState("");

  const addCustomSize = () => {
    const s = newSizeInput.trim().toUpperCase();
    if (!s) return;
    if (SIZES.includes(s) || customSizes.includes(s)) { showToast(`"${s}" already exists!`, "error"); return; }
    setCustomSizes([...customSizes, s]);
    setNewSizeInput("");
    showToast(`Size "${s}" add ho gaya!`);
  };
  const deleteCustomSize = (s) => {
    if (!window.confirm(`Size "${s}" delete karoge?`)) return;
    setCustomSizes(customSizes.filter(x => x !== s));
    showToast(`Size "${s}" delete ho gaya!`);
  };

  // ── Backup: download all data as JSON ──
  const downloadBackup = () => {
    const backup = {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      shopName,
      billCounter,
      products,
      sales,
      purchases,
      customers,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FashionPro_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✅ Backup download ho gaya!");
  };

  // ── Restore: load from JSON file ──
  const restoreBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.products || !data.sales) throw new Error("Invalid backup file");
        if (!window.confirm(`Backup restore karoge?\n\nFile: ${file.name}\nExported: ${data.exportedAt || "unknown"}\n\n⚠️ Current data replace ho jaayega!\n\nNote: Dusre tabs/devices pe sirf yeh tab kholkar raho Firebase sync ke liye.`)) return;
        // BUG36 FIX: Restore se pehle clear state — taaki Firebase listener se purana data merge na ho
        // setProducts([]) pehle call karo taaki smartSave empty-to-new transition correctly handle kare
        setProducts([]);
        setSales([]);
        setCustomers([]);
        setPurchases([]);
        // Small delay — clear operations queue mein jaayein pehle
        await new Promise(r => setTimeout(r, 100));
        // BUG22 FIX: setProducts/setSales etc. ab smartSave call karte hain
        // >20 items = full saveCollection → Firebase automatically sync hota hai restore pe
        if (data.products) setProducts(data.products);
        if (data.sales) setSales(data.sales);
        if (data.purchases) setPurchases(data.purchases);
        if (data.customers) setCustomers(data.customers);
        if (data.shopName) setShopName(data.shopName);
        if (data.billCounter) setBillCounter(data.billCounter);
        // BUG35 FIX: data.customers?.length — agar customers field missing ho toh crash nahi hoga
        const cLen = data.customers?.length || 0;
        setRestoreStatus({ ok: true, msg: `✅ Restore ho gaya! ${data.sales.length} bills, ${data.products.length} products, ${cLen} customers.` });
        showToast("✅ Data restore ho gaya!");
      } catch (err) {
        setRestoreStatus({ ok: false, msg: "❌ File sahi nahi hai — FashionPro backup JSON chahiye" });
        showToast("Restore failed", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be loaded again
  };

  return (
    <div className="page">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: "#111827" }}>🏪 Shop Information</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label className="label">Shop Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label className="label">Address</label><textarea className="input" value={address} onChange={e => setAddress(e.target.value)} rows={3} style={{ resize: "vertical" }} /></div>
            <div><label className="label">Phone</label><input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div><label className="label">GST Number</label><input className="input" value={gst} onChange={e => setGst(e.target.value)} /></div>
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => {
                setShopName(name);
                try {
                  localStorage.setItem('shopAddress', address);
                  localStorage.setItem('shopPhone', phone);
                  localStorage.setItem('shopGst', gst);
                  localStorage.setItem('shopName', name);
                } catch(e) {}
                showToast("✅ Settings save ho gaya!");
              }}>💾 Save Changes</button>
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: "#111827" }}>⚙️ System Preferences</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="label">Low Stock Alert Threshold</label>
              <input className="input" type="number" onWheel={e=>e.target.blur()} value={lowStockThreshold} onChange={e => setLowStockThreshold(+e.target.value)} />
              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 5 }}>Show alert when stock falls below this number</p>
            </div>
            <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>User Access</p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>Admin</p>
                  <p style={{ fontSize: 12, color: "#9ca3af" }}>Full access to all features</p>
                </div>
                <span className="badge badge-purple">Active</span>
              </div>
            </div>
            <button className="btn btn-outline" onClick={() => showToast("Preferences saved!")}>Save Preferences</button>
          </div>
        </div>
      </div>

      {/* ── Custom Sizes ── */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#111827" }}>📏 Custom Sizes</h3>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Jo sizes default list mein nahi hain unhe yahan add karo. Inventory mein product add karte waqt dikhengi.</p>

        {/* Add new size */}
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          <input
            className="input"
            value={newSizeInput}
            onChange={e => setNewSizeInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCustomSize()}
            placeholder="e.g. FREE, 44, 46, 2XL, 3XL..."
            style={{ flex:1 }}
          />
          <button onClick={addCustomSize} className="btn" style={{ whiteSpace:"nowrap" }}>+ Add Size</button>
        </div>

        {/* Default sizes — read only */}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", marginBottom:6 }}>Default Sizes (edit nahi ho sakti)</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {SIZES.map(s => (
              <span key={s} style={{ padding:"4px 10px", borderRadius:7, background:"#f3f4f6", color:"#6b7280", fontSize:12, fontWeight:600 }}>{s}</span>
            ))}
          </div>
        </div>

        {/* Custom sizes — deletable */}
        {customSizes.length > 0 && (
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:"#7c3aed", textTransform:"uppercase", marginBottom:6 }}>Aapki Custom Sizes</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {customSizes.map(s => (
                <span key={s} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 8px 4px 12px", borderRadius:7, background:"#f5f3ff", border:"1.5px solid #a855f7", color:"#7c3aed", fontSize:12, fontWeight:700 }}>
                  {s}
                  <button onClick={() => deleteCustomSize(s)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, color:"#dc2626", fontSize:14, lineHeight:1, display:"flex", alignItems:"center" }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
        {customSizes.length === 0 && (
          <p style={{ fontSize:12, color:"#d1d5db", fontStyle:"italic" }}>Abhi koi custom size nahi hai. Upar se add karo.</p>
        )}
      </div>

      {/* ── Data Backup & Restore ── */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#111827" }}>💾 Data Backup & Restore</h3>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 18 }}>Apna poora data backup karo — bills, customers, inventory sab. Kisi bhi device pe restore kar sako.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Backup */}
          <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⬇️</div>
            <h4 style={{ fontWeight: 800, fontSize: 14, color: "#1e40af", marginBottom: 6 }}>Backup Download</h4>
            <p style={{ fontSize: 12, color: "#3b82f6", marginBottom: 14, lineHeight: 1.5 }}>
              Sab kuch ek JSON file mein save ho jaata hai —
              bills ({sales.length}), products ({products.length}),
              customers ({customers.length}), purchases ({purchases.length})
            </p>
            <button onClick={downloadBackup} className="btn"
              style={{ width: "100%", justifyContent: "center", background: "#2563eb", color: "white", fontWeight: 700 }}>
              <Icon name="download" size={16} /> Backup Download Karo
            </button>
          </div>

          {/* Restore */}
          <div style={{ background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⬆️</div>
            <h4 style={{ fontWeight: 800, fontSize: 14, color: "#92400e", marginBottom: 6 }}>Backup Restore</h4>
            <p style={{ fontSize: 12, color: "#d97706", marginBottom: 14, lineHeight: 1.5 }}>
              Pehle ki backup file se data wapas laao. JSON file select karo — sab kuch restore ho jaayega.
            </p>
            <label style={{ width: "100%", padding: "10px", background: "#d97706", color: "white", fontWeight: 700, fontSize: 13, border: "none", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              📂 Backup File Choose Karo
              <input type="file" accept=".json" onChange={restoreBackup} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        {restoreStatus && (
          <div style={{ marginTop: 14, padding: "12px 16px", background: restoreStatus.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${restoreStatus.ok ? "#86efac" : "#fecaca"}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: restoreStatus.ok ? "#059669" : "#dc2626" }}>
            {restoreStatus.msg}
          </div>
        )}

        <div style={{ marginTop: 14, background: "#f9fafb", borderRadius: 10, padding: "12px 16px" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>💡 Tips:</p>
          <ul style={{ fontSize: 11, color: "#6b7280", listStyle: "disc", paddingLeft: 16, lineHeight: 1.8 }}>
            <li>Roz raat backup download karo — safe rahega data</li>
            <li>File naam mein date hoti hai: FashionPro_Backup_2026-03-08.json</li>
            <li>Google Drive ya WhatsApp pe save kar lo file ko</li>
            <li>Naye phone pe shift karna ho toh restore karo</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        {/* Firebase Security Info */}
        <div className="card" style={{ marginBottom: 20, background: "#fffbeb", border: "1.5px solid #fcd34d" }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 8, color: "#92400e" }}>🔐 Firebase Security Status</h3>
          <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.7 }}>
            <p><b>Current Status:</b> Firebase FREE plan (Spark) — koi trial nahi hota. Data hamesha save rehta hai.</p>
            <p style={{ marginTop: 8 }}><b>Security Rules (IMPORTANT):</b> Abhi rules open hain. Production mein use karne se pehle Firebase Console mein jaake rules update karo:</p>
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginTop: 8, fontFamily: "monospace", fontSize: 11, whiteSpace: "pre-wrap" }}>
              <div>{"rules_version = '2';"}</div>
              <div>{"service cloud.firestore {"}</div>
              <div>{"  match /databases/{database}/documents {"}</div>
              <div>{"    match /{document=**} {"}</div>
              <div>{"      allow read, write: if true;"}</div>
              <div>{"    }"}</div>
              <div>{"  }"}</div>
              <div>{"}"}</div>
            </div>
            <p style={{ marginTop: 8, fontSize: 12, color: "#92400e" }}>
              💡 <b>Secure karne ke liye:</b> Firebase Console → Firestore → Rules tab mein jaao aur rules update karo.
              Agar chahte ho password-protected access, toh Firebase Authentication add karna padega.
            </p>
          </div>
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#111827" }}>📊 About FashionPro</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {[["Version", "2.1.0"], ["Build", "2026"], ["Platform", "Web App"], ["Database", "JSON Backup"]].map(([k, v]) => (
            <div key={k} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px" }}>
              <p style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, marginBottom: 4 }}>{k}</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>{v}</p>
            </div>
          ))}
        </div>

        {/* ── DATA DELETE SECTION ── */}
        <DataDeleteSection
          sales={sales} products={products} purchases={purchases} customers={customers}
          setSales={setSales} setProducts={setProducts} setPurchases={setPurchases}
          setCustomers={setCustomers} setBillCounter={setBillCounter}
          showToast={showToast}
        />
      </div>
    </div>
  );
};

// ── DATA DELETE COMPONENT ──
const DataDeleteSection = ({ sales, products, purchases, customers, setSales, setProducts, setPurchases, setCustomers, setBillCounter, showToast }) => {
  const [selected, setSelected] = React.useState({ sales: false, products: false, purchases: false, customers: false });
  const [step, setStep] = React.useState("select"); // select | preview | confirm
  const [confirmText, setConfirmText] = React.useState("");

  const toggleAll = (val) => setSelected({ sales: val, products: val, purchases: val, customers: val });
  const anySelected = Object.values(selected).some(Boolean);

  const previewData = {
    sales: { label: "Sales / Bills", count: sales.length, color: "#7c3aed", icon: "🧾" },
    products: { label: "Inventory / Products", count: products.length, color: "#0891b2", icon: "📦" },
    purchases: { label: "Purchase Records", count: purchases.length, color: "#d97706", icon: "🛒" },
    customers: { label: "Customers", count: customers.length, color: "#059669", icon: "👥" },
  };

  const selectedItems = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
  const totalRecords = selectedItems.reduce((a, k) => a + previewData[k].count, 0);

  const doDelete = async () => {
    setStep("deleting");
    try {
      // Delete from Firebase (each document individually in batches)
      const deleteCollection = async (colName, items) => {
        if (!items || items.length === 0) return;
        const batch = writeBatch(db);
        items.forEach(item => {
          if (item.id) batch.delete(doc(db, colName, String(item.id)));
        });
        await batch.commit();
        // Clear localStorage cache too
        try { localStorage.removeItem("fp_cache_" + colName); } catch {}
      };

      if (selected.sales) {
        await deleteCollection("sales", sales);
        setSales([]);
        // Reset bill counter in Firebase
        await setDoc(doc(db, "meta", "billCounter"), { value: 1 }).catch(() => {});
        setBillCounter(1);
        try { localStorage.removeItem("fp_cache_sales"); } catch {}
      }
      if (selected.products) {
        await deleteCollection("products", products);
        setProducts([]);
      }
      if (selected.purchases) {
        await deleteCollection("purchases", purchases);
        setPurchases([]);
      }
      if (selected.customers) {
        await deleteCollection("customers", customers);
        setCustomers([]);
      }

      showToast(`✅ ${totalRecords} records Firebase se bhi delete ho gaye!`);
    } catch(e) {
      showToast("⚠️ Delete error: " + e.message, "error");
    }
    setStep("select");
    setSelected({ sales: false, products: false, purchases: false, customers: false });
    setConfirmText("");
  };

  return (
    <div className="card" style={{ border: "2px solid #fca5a5", marginTop: 20 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#dc2626", marginBottom: 4 }}>🗑️ Data Delete</h3>
      <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Carefully select which data to delete. Yeh action undo nahi hoga.</p>

      {step === "select" && (
        <>
          {/* Select All */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => toggleAll(true)} style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#f9fafb", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>☑️ Sab Select</button>
            <button onClick={() => toggleAll(false)} style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#f9fafb", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬜ Sab Clear</button>
          </div>

          {/* Checkboxes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {Object.entries(previewData).map(([key, info]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${selected[key] ? info.color : "#e5e7eb"}`, background: selected[key] ? `${info.color}10` : "white" }}>
                <input type="checkbox" checked={selected[key]} onChange={e => setSelected(p => ({...p, [key]: e.target.checked}))} style={{ width: 18, height: 18, cursor: "pointer" }} />
                <span style={{ fontSize: 16 }}>{info.icon}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{info.label}</span>
                <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 700 }}>{info.count} records</span>
              </label>
            ))}
          </div>

          <button
            disabled={!anySelected}
            onClick={() => setStep("preview")}
            style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: anySelected ? "#dc2626" : "#f3f4f6", color: anySelected ? "white" : "#9ca3af", fontWeight: 700, fontSize: 14, cursor: anySelected ? "pointer" : "not-allowed" }}
          >
            🔍 Preview karo kya delete hoga →
          </button>
        </>
      )}

      {step === "preview" && (
        <>
          <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#dc2626", marginBottom: 8 }}>⚠️ Yeh sab delete hoga:</p>
            {selectedItems.map(key => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed #fca5a5", fontSize: 13 }}>
                <span>{previewData[key].icon} {previewData[key].label}</span>
                <span style={{ fontWeight: 700, color: "#dc2626" }}>{previewData[key].count} records</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontWeight: 800, fontSize: 14 }}>
              <span>Total</span>
              <span style={{ color: "#dc2626" }}>{totalRecords} records delete honge</span>
            </div>
          </div>

          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Confirm karne ke liye neeche <b>"DELETE"</b> likho:</p>
          <input
            value={confirmText} onChange={e => setConfirmText(e.target.value)}
            placeholder='Yahan "DELETE" likho'
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #fca5a5", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
          />

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setStep("select"); setConfirmText(""); }} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              ← Wapas jao
            </button>
            <button
              disabled={confirmText !== "DELETE" || step === "deleting"}
              onClick={doDelete}
              style={{ flex: 2, padding: "11px 0", borderRadius: 10, border: "none", background: confirmText === "DELETE" ? "#dc2626" : "#f3f4f6", color: confirmText === "DELETE" ? "white" : "#9ca3af", fontWeight: 700, fontSize: 14, cursor: confirmText === "DELETE" ? "pointer" : "not-allowed" }}
            >
              {step === "deleting" ? "⏳ Delete ho raha hai..." : "🗑️ Haan, Delete Karo"}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
