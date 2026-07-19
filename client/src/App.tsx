import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import WorkoutPage from "./pages/Workout";
import NutritionPage from "./pages/Nutrition";
import SleepPage from "./pages/Sleep";
import VitaminsPage from "./pages/Vitamins";
import SettingsPage from "./pages/Settings";

const NAV = [
  { to: "/dashboard", label: "Dashboard", color: "var(--series-1)" },
  { to: "/workout", label: "Workout", color: "var(--series-6)" },
  { to: "/nutrition", label: "Nutrition", color: "var(--series-2)" },
  { to: "/sleep", label: "Sleep", color: "var(--series-7)" },
  { to: "/vitamins", label: "Vitamins", color: "var(--series-5)" },
  { to: "/settings", label: "Settings", color: "var(--muted)" },
];

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">Health</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `navlink${isActive ? " active" : ""}`}
          >
            <span className="dot" style={{ background: n.color }} />
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
          <Route path="/nutrition" element={<NutritionPage />} />
          <Route path="/sleep" element={<SleepPage />} />
          <Route path="/vitamins" element={<VitaminsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
