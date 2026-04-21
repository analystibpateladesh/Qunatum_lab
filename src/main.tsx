import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles.css";

import PricerPage from "./routes/index";
import MarketPage from "./routes/market";
import VarPage from "./routes/var";
import HedgingPage from "./routes/hedging";
import SensitivityPage from "./routes/sensitivity";
import StrategyPage from "./routes/strategies";
import SurfacePage from "./routes/surface";

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go home
        </a>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PricerPage />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/var" element={<VarPage />} />
        <Route path="/hedging" element={<HedgingPage />} />
        <Route path="/sensitivity" element={<SensitivityPage />} />
        <Route path="/strategies" element={<StrategyPage />} />
        <Route path="/surface" element={<SurfacePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
