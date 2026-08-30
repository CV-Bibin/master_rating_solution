// src/components/ProtectedRoute.jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { currentUser, userRole } = useAuth();

  // If not logged in at all, go to login page
  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  // If this route requires admin, but the user is just a rater, send them to the workspace
  if (requireAdmin && userRole !== "admin") {
    return <Navigate to="/workspace" />;
  }

  return children;
}