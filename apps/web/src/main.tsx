import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AuditPage, SharesPage, UsersPage } from "./pages/admin.js";
import { DocumentPage } from "./pages/document.js";
import { LibraryPage } from "./pages/library.js";
import { StaffShell } from "./pages/shell.js";
import { ViewerPage } from "./pages/viewer.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/s/:token" element={<ViewerPage />} />
        <Route element={<StaffShell />}>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/documents/:id" element={<DocumentPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/shares" element={<SharesPage />} />
          <Route path="/admin/audit" element={<AuditPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
