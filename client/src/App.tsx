import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import WorkoutPage from "./pages/Workout";
import CardioPage from "./pages/Cardio";
import NutritionPage from "./pages/Nutrition";
import SleepPage from "./pages/Sleep";
import VitaminsPage from "./pages/Vitamins";
import MobilityPage from "./pages/Mobility";
import SettingsPage from "./pages/Settings";

/** Stroke-icon wrapper: consistent size/stroke for every tab icon. */
function Ico(props: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <Ico>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Ico>
  ),
  workout: (
    <Ico>
      <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />
    </Ico>
  ),
  cardio: (
    <Ico>
      <path d="M12 20.5S4.5 16 4.5 10.2A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6C19.5 16 12 20.5 12 20.5z" />
      <path d="M8.5 11.5h2l1.5-2.5 1.5 4 1-1.5h1.5" />
    </Ico>
  ),
  nutrition: (
    <Ico>
      <path d="M15.5 6.2c1.6 0 4 1.6 4 5.1 0 4.3-2.9 8.2-4.7 8.2-.9 0-1.6-.6-2.8-.6s-1.9.6-2.8.6c-1.8 0-4.7-3.9-4.7-8.2 0-3.5 2.4-5.1 4-5.1 1.4 0 2.4.8 3.5.8s2.1-.8 3.5-.8z" />
      <path d="M12 6.5c0-2.2 1.4-3.7 3.2-4" />
    </Ico>
  ),
  sleep: (
    <Ico>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
    </Ico>
  ),
  vitamins: (
    <Ico>
      <rect x="3.2" y="8.4" width="17.6" height="7.2" rx="3.6" transform="rotate(-45 12 12)" />
      <path d="M9.5 14.5l5-5" />
    </Ico>
  ),
  mobility: (
    <Ico>
      <circle cx="12" cy="5" r="2.1" />
      <path d="M12 13V9.2M4.5 19c1.6-4 4.2-6 7.5-6s5.9 2 7.5 6" />
    </Ico>
  ),
  settings: (
    <Ico>
      <path d="M4 7h9M17.5 7H20M4 12h3.5M12 12h8M4 17h11M19.5 17H20" />
      <circle cx="15.2" cy="7" r="1.9" />
      <circle cx="9.8" cy="12" r="1.9" />
      <circle cx="17.2" cy="17" r="1.9" />
    </Ico>
  ),
};

const NAV = [
  { to: "/dashboard", label: "Home", color: "var(--series-1)", icon: "dashboard" },
  { to: "/workout", label: "Workout", color: "var(--series-6)", icon: "workout" },
  { to: "/cardio", label: "Cardio", color: "var(--series-4)", icon: "cardio" },
  { to: "/nutrition", label: "Nutrition", color: "var(--series-2)", icon: "nutrition" },
  { to: "/sleep", label: "Sleep", color: "var(--series-7)", icon: "sleep" },
  { to: "/vitamins", label: "Vitamins", color: "var(--series-5)", icon: "vitamins" },
  { to: "/mobility", label: "Mobility", color: "var(--series-3)", icon: "mobility" },
  { to: "/settings", label: "Settings", color: "var(--muted)", icon: "settings" },
];

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">D</span>
          Darfum
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            style={{ ["--nav-color" as string]: n.color }}
            className={({ isActive }) => `navlink${isActive ? " active" : ""}`}
          >
            <span className="nav-ico">{ICONS[n.icon]}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workout" element={<WorkoutPage />} />
          <Route path="/cardio" element={<CardioPage />} />
          <Route path="/nutrition" element={<NutritionPage />} />
          <Route path="/sleep" element={<SleepPage />} />
          <Route path="/vitamins" element={<VitaminsPage />} />
          <Route path="/mobility" element={<MobilityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
