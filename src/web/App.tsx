import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { buildStore, StoreContext, type Bundle, type Store } from './store';
import { Overview } from './pages/Overview';
import { Cases, CaseDetail } from './pages/Cases';
import { Compare } from './pages/Compare';
import { Invariance } from './pages/Invariance';
import { Review } from './pages/Review';
import { Sandbox } from './pages/Sandbox';
import { Standards } from './pages/Standards';

/** 切换页面时回到顶部（单页应用默认会保留上一页的滚动位置） */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch('./data/bundle.json')
      .then((r) => {
        if (!r.ok) throw new Error(`数据包加载失败：HTTP ${r.status}`);
        return r.json();
      })
      .then((b: Bundle) => setStore(buildStore(b)))
      .catch((e) => setErr(String(e)));
  }, []);
  if (err) return <div className="loading">加载失败：{err}</div>;
  if (!store) return <div className="loading">正在加载数据并在浏览器内运行评测…</div>;
  return (
    <StoreContext.Provider value={store}>
      <HashRouter>
        <ScrollToTop />
        <header className="top">
          <div className="top-inner">
            <div className="brand">
              <span className="brand-mark" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 13l4.2-4.6 3.2 2.6L16 4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div>
                <div className="brand-title">投资 Agent 回答质量与个性化治理平台</div>
                <div className="brand-sub">评测 · 核验 · 归因 · 复核 · 发布闸门</div>
              </div>
            </div>
            <nav className="main-nav">
              <NavLink to="/" end>
                总览
              </NavLink>
              <NavLink to="/cases">评测记录</NavLink>
              <NavLink to="/compare">版本对比</NavLink>
              <NavLink to="/invariance">画像一致性</NavLink>
              <NavLink to="/review">人工复核</NavLink>
              <NavLink to="/sandbox">在线评测</NavLink>
              <NavLink to="/standards">质量标准</NavLink>
            </nav>
            <div className="top-meta">
              <span>
                扶摇快照 <b>{store.bundle.meta.latest_trading_day}</b>
              </span>
              <span>
                <b>{store.bundle.logs.length}</b> 条回答 · <b>{store.bundle.versions.length}</b> 个版本
              </span>
            </div>
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/invariance" element={<Invariance />} />
            <Route path="/review" element={<Review />} />
            <Route path="/sandbox" element={<Sandbox />} />
            <Route path="/standards" element={<Standards />} />
          </Routes>
        </main>
        <footer className="foot muted">
          事实数据来自扶摇（同花顺金融数据 API）快照；KYC 画像、问题集、用户行为反馈为匿名构造或模拟数据；本站不构成任何投资建议。
        </footer>
      </HashRouter>
    </StoreContext.Provider>
  );
}
