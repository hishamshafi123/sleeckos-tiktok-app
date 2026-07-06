"use client";
import React, { useState, useEffect, useRef } from "react";
import {
  Folder,
  FolderPlus,
  FileSpreadsheet,
  Plus,
  Trash2,
  Share2,
  Lock,
  Eye,
  EyeOff,
  Download,
  Upload,
  ChevronRight,
  ChevronDown,
  Edit,
  Database,
  LockKeyhole,
  Check,
  X,
  FileDown,
  UserPlus,
  Shield,
  Clock,
  ExternalLink,
  Loader2,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

interface FolderNode {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdBy: string | null;
  createdAt: string;
  permission: "view" | "edit" | "manage";
  sheets: { id: string; name: string; createdAt: string }[];
  accessList?: any[];
}

interface SheetData {
  id: string;
  name: string;
  folderId: string;
  permission: "view" | "edit" | "manage";
  columns: { id: string; name: string; type: string; order: number }[];
  rows: {
    id: string;
    order: number;
    cells: {
      id: string;
      rowId: string;
      columnId: string;
      value: string | null;
      isSecret: boolean;
      hasValue: boolean;
    }[];
  }[];
}

interface UserListItem {
  id: string;
  name: string | null;
  email: string;
  role: { label: string; key: string };
}

interface RoleListItem {
  id: string;
  key: string;
  label: string;
}

export default function VaultClientPage({
  currentUserId,
  userRole
}: {
  currentUserId: string;
  userRole: string;
}) {
  // Navigation / Directory States
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  
  // Sheet Contents States
  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [revealedCells, setRevealedCells] = useState<Record<string, string>>({}); // cellId -> decrypted plaintext
  const [revealingCellId, setRevealingCellId] = useState<string | null>(null);

  // Sharing & Metadata Lists
  const [usersList, setUsersList] = useState<UserListItem[]>([]);
  const [rolesList, setRolesList] = useState<RoleListItem[]>([]);
  const [folderAccessList, setFolderAccessList] = useState<any[]>([]);

  // Modal Control States
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderModalParentId, setFolderModalParentId] = useState<string | null>(null);
  const [folderModalName, setFolderModalName] = useState("");

  const [showSheetModal, setShowSheetModal] = useState(false);
  const [sheetModalName, setSheetModalName] = useState("");

  const [showColumnModal, setShowColumnModal] = useState(false);
  const [columnModalName, setColumnModalName] = useState("");
  const [columnModalType, setColumnModalType] = useState("text");

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalFolderId, setShareModalFolderId] = useState<string | null>(null);
  const [shareTargetType, setShareTargetType] = useState<"user" | "role">("user");
  const [shareTargetId, setShareTargetId] = useState("");
  const [sharePermission, setSharePermission] = useState<"view" | "edit" | "manage">("view");

  const [showImportModal, setShowImportModal] = useState(false);
  const [importCsvData, setImportCsvData] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, { columnId?: string; isNew: boolean; newName: string; newType: string }>>({});
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);

  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  // Initialize and load directory
  useEffect(() => {
    fetchFolders();
    fetchUsersAndRoles();
  }, []);

  // Fetch sheet details when sheet selection changes
  useEffect(() => {
    if (selectedSheetId) {
      fetchSheet(selectedSheetId);
    } else {
      setSheetData(null);
    }
    setRevealedCells({});
  }, [selectedSheetId]);

  const fetchFolders = async () => {
    setLoadingFolders(true);
    try {
      const res = await fetch("/api/managed/vault/folders");
      if (!res.ok) throw new Error("Failed to fetch folders structure");
      const data = await res.json();
      setFolders(data);
    } catch (err: any) {
      toast.error(err.message || "Error reading vault directory");
    } finally {
      setLoadingFolders(false);
    }
  };

  const fetchUsersAndRoles = async () => {
    try {
      const res = await fetch("/api/managed/vault/users");
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
        setRolesList(data.roles || []);
      }
    } catch (err) {
      console.warn("Failed to retrieve users/roles list", err);
    }
  };

  const fetchSheet = async (sheetId: string) => {
    setLoadingSheet(true);
    try {
      const res = await fetch(`/api/managed/vault/sheets/${sheetId}`);
      if (!res.ok) throw new Error("Unable to read spreadsheet");
      const data = await res.json();
      setSheetData(data);
    } catch (err: any) {
      toast.error(err.message || "Spreadsheet load error");
      setSelectedSheetId(null);
    } finally {
      setLoadingSheet(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderModalName.trim()) return;

    try {
      const res = await fetch("/api/managed/vault/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderModalName.trim(),
          parentFolderId: folderModalParentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create folder");

      toast.success(`Folder "${folderModalName}" created successfully`);
      setFolderModalName("");
      setShowFolderModal(false);
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || "Folder creation failed");
    }
  };

  const handleCreateSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetModalName.trim() || !selectedFolderId) return;

    try {
      const res = await fetch("/api/managed/vault/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: selectedFolderId,
          name: sheetModalName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create sheet");

      toast.success(`Spreadsheet "${sheetModalName}" added`);
      setSheetModalName("");
      setShowSheetModal(false);
      fetchFolders();
      setSelectedSheetId(data.id);
    } catch (err: any) {
      toast.error(err.message || "Spreadsheet creation failed");
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm("Are you sure you want to delete this folder and all subfolders/sheets inside it?")) return;

    try {
      const res = await fetch(`/api/managed/vault/folders?folderId=${folderId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete folder");

      toast.success("Folder deleted");
      if (selectedFolderId === folderId) setSelectedFolderId(null);
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || "Folder deletion failed");
    }
  };

  const handleDeleteSheet = async (sheetId: string) => {
    if (!confirm("Delete this spreadsheet entirely?")) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${sheetId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete sheet");

      toast.success("Spreadsheet deleted");
      if (selectedSheetId === sheetId) setSelectedSheetId(null);
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || "Spreadsheet deletion failed");
    }
  };

  const handleAddColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnModalName.trim() || !selectedSheetId) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: columnModalName.trim(),
          type: columnModalType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add column");

      toast.success(`Column "${columnModalName}" added`);
      setColumnModalName("");
      setShowColumnModal(false);
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to add column");
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    if (!selectedSheetId || !confirm("Are you sure you want to delete this column and all cells inside it?")) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns?columnId=${columnId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete column");

      toast.success("Column deleted");
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete column");
    }
  };

  const handleAddRow = async () => {
    if (!selectedSheetId) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add row");

      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to add row");
    }
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!selectedSheetId || !confirm("Delete this row?")) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows?rowId=${rowId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete row");

      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete row");
    }
  };

  const handleStartEditCell = (rowId: string, columnId: string, currentValue: string | null) => {
    if (sheetData?.permission === "view") return; // Read-only access
    setEditingCell({ rowId, columnId });
    setEditValue(currentValue || "");
  };

  const handleSaveCell = async (rowId: string, columnId: string) => {
    if (!selectedSheetId) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/cells`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId,
          columnId,
          value: editValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cell update failed");

      // Update local state directly to prevent layout flickers
      setSheetData((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r: any) => {
            if (r.id !== rowId) return r;
            return {
              ...r,
              cells: r.cells.map((c: any) => {
                if (c.columnId !== columnId) return c;
                const column = prev.columns.find((col: any) => col.id === columnId);
                const isSecret = column?.type === "secret";
                return {
                  ...c,
                  value: isSecret ? "••••••" : editValue,
                  hasValue: editValue.trim() !== "",
                };
              }),
            };
          }),
        };
      });
      setEditingCell(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to save cell data");
    }
  };

  const handleRevealSecret = async (cellId: string) => {
    if (!selectedSheetId) return;

    if (revealedCells[cellId]) {
      // Toggle off / mask again
      setRevealedCells((prev) => {
        const copy = { ...prev };
        delete copy[cellId];
        return copy;
      });
      return;
    }

    setRevealingCellId(cellId);
    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to reveal value");

      setRevealedCells((prev) => ({ ...prev, [cellId]: data.value }));
    } catch (err: any) {
      toast.error(err.message || "Access denied for secret decryption");
    } finally {
      setRevealingCellId(null);
    }
  };

  // Folder Access Settings (Sharing)
  const openShareModal = (folder: FolderNode) => {
    setShareModalFolderId(folder.id);
    setFolderAccessList(folder.accessList || []);
    setShareTargetId("");
    setShowShareModal(true);
  };

  const handleAddShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareModalFolderId || !shareTargetId) return;

    try {
      const payload: any = {
        folderId: shareModalFolderId,
        permission: sharePermission,
      };
      if (shareTargetType === "user") payload.userId = shareTargetId;
      else payload.roleKey = shareTargetId;

      const res = await fetch("/api/managed/vault/folders/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to share folder");

      toast.success("Access permissions updated");
      setShareTargetId("");
      fetchFolders().then(() => {
        // Find folder again to update the sharing list inside state
        const updatedFolder = folders.find((f) => f.id === shareModalFolderId);
        if (updatedFolder) setFolderAccessList(updatedFolder.accessList || []);
      });
      setShowShareModal(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update sharing");
    }
  };

  const handleRevokeShare = async (accessId: string) => {
    if (!shareModalFolderId || !confirm("Revoke access for this target?")) return;

    try {
      const res = await fetch(`/api/managed/vault/folders/access?folderId=${shareModalFolderId}&accessId=${accessId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke access");

      toast.success("Access revoked");
      fetchFolders();
      setShowShareModal(false);
    } catch (err: any) {
      toast.error(err.message || "Revocation failed");
    }
  };

  // CSV Export Handler
  const handleExportCsv = async (includeSecrets: boolean) => {
    if (!selectedSheetId) return;

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/csv?includeSecrets=${includeSecrets}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Export failed");
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sheet_${sheetData?.name || selectedSheetId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("Spreadsheet CSV exported");
    } catch (err: any) {
      toast.error(err.message || "Export failed");
    }
  };

  // CSV Import Parse/Setup
  const handleCsvFileSelected = async (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setImportCsvData(text);

      // Parse headers
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length > 0) {
        // Simplistic comma split for headers list
        const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
        setImportHeaders(headers);

        // Prepopulate mapping state
        const initialMapping: Record<string, any> = {};
        for (const h of headers) {
          // Attempt match with existing columns
          const match = sheetData?.columns.find((col) => col.name.toLowerCase() === h.toLowerCase());
          initialMapping[h] = {
            columnId: match?.id || "",
            isNew: !match,
            newName: h,
            newType: "text",
          };
        }
        setImportMapping(initialMapping);
      }
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async () => {
    if (!selectedSheetId || !importCsvData) return;

    setImporting(true);
    try {
      // Structure mapper format
      const mappingPayload = Object.entries(importMapping).map(([header, config]) => ({
        csvHeader: header,
        columnId: config.isNew ? undefined : config.columnId,
        newName: config.isNew ? config.newName : undefined,
        newType: config.isNew ? config.newType : undefined,
      }));

      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvData: importCsvData,
          columnMapping: mappingPayload,
          mode: importMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      toast.success(`Successfully imported ${data.count} rows!`);
      setShowImportModal(false);
      setImportCsvData("");
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to import CSV dataset");
    } finally {
      setImporting(false);
    }
  };

  // Audit Logs Display
  const openAuditLogs = async () => {
    setLoadingAuditLogs(true);
    setShowAuditLogs(true);
    try {
      const res = await fetch("/api/managed/vault/audit-logs");
      if (!res.ok) throw new Error("Could not fetch log data");
      const data = await res.json();
      setAuditLogs(data);
    } catch (err: any) {
      toast.error(err.message || "Logs fetch failed");
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  // Recursively render Folder Tree
  const renderFolderTree = (parentId: string | null, depth = 0) => {
    const levelFolders = folders.filter((f) => f.parentFolderId === parentId);
    
    return (
      <div className="space-y-1">
        {levelFolders.map((folder) => {
          const isExpanded = !!expandedFolders[folder.id];
          const isSelected = selectedFolderId === folder.id;
          
          return (
            <div key={folder.id} className="space-y-0.5" style={{ marginLeft: `${depth * 10}px` }}>
              <div
                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  isSelected
                    ? "bg-[#2563eb]/10 text-white border border-[#2563eb]/20"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent"
                }`}
                onClick={() => {
                  setSelectedFolderId(folder.id);
                  setExpandedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }));
                }}
              >
                <div className="flex items-center gap-2 truncate">
                  <button className="text-zinc-600 hover:text-zinc-400">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? "text-blue-500" : "text-zinc-500"}`} />
                  <span className="truncate">{folder.name}</span>
                </div>

                <div className="hidden group-hover:flex items-center gap-1.5 flex-shrink-0">
                  {folder.permission === "manage" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openShareModal(folder);
                      }}
                      title="Share Access"
                      className="text-zinc-500 hover:text-blue-400 p-0.5 rounded hover:bg-zinc-800 transition-all"
                    >
                      <Share2 className="w-3 h-3" />
                    </button>
                  )}
                  {folder.permission !== "view" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderModalParentId(folder.id);
                        setFolderModalName("");
                        setShowFolderModal(true);
                      }}
                      title="Add Subfolder"
                      className="text-zinc-500 hover:text-green-400 p-0.5 rounded hover:bg-zinc-800 transition-all"
                    >
                      <FolderPlus className="w-3 h-3" />
                    </button>
                  )}
                  {folder.permission === "manage" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFolder(folder.id);
                      }}
                      title="Delete Folder"
                      className="text-zinc-500 hover:text-red-400 p-0.5 rounded hover:bg-zinc-800 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-0.5">
                  {/* Sheets */}
                  {folder.sheets.map((sheet) => {
                    const isSheetSelected = selectedSheetId === sheet.id;
                    return (
                      <div
                        key={sheet.id}
                        style={{ marginLeft: `${(depth + 1) * 10}px` }}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                          isSheetSelected
                            ? "bg-zinc-800 text-white border border-zinc-700"
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 border border-transparent"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFolderId(folder.id);
                          setSelectedSheetId(sheet.id);
                        }}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileSpreadsheet className={`w-3.5 h-3.5 flex-shrink-0 ${isSheetSelected ? "text-emerald-500" : "text-zinc-600"}`} />
                          <span className="truncate">{sheet.name}</span>
                        </div>

                        {folder.permission !== "view" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSheet(sheet.id);
                            }}
                            title="Delete Sheet"
                            className="hidden group-hover:block text-zinc-500 hover:text-red-400 p-0.5 rounded hover:bg-zinc-800 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Recursive children subfolders */}
                  {renderFolderTree(folder.id, depth + 1)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-[calc(100vh-80px)] w-full gap-4 text-zinc-200">
      
      {/* ── LEFT PANEL: TREE STRUCTURE ──────────────────────────────────────── */}
      <div className="w-64 bg-[#09090b] border border-[#27272a] rounded-xl flex flex-col p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Vault Files</h2>
          </div>
          <button
            onClick={() => {
              setFolderModalParentId(null);
              setFolderModalName("");
              setShowFolderModal(true);
            }}
            className="p-1 rounded bg-[#2563eb]/10 border border-[#2563eb]/20 text-[#2563eb] hover:bg-[#2563eb]/20 transition-all"
            title="Create Root Folder"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 select-none pr-1">
          {loadingFolders ? (
            <div className="flex flex-col items-center justify-center h-40 space-y-2">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <p className="text-[10px] text-zinc-500 font-semibold uppercase">Loading directory...</p>
            </div>
          ) : folders.length === 0 ? (
            <div className="text-center p-4">
              <Folder className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-500 font-bold">No Folders Configured</p>
              <p className="text-[10px] text-zinc-600 mt-1">Create a root directory using the button above.</p>
            </div>
          ) : (
            renderFolderTree(null)
          )}
        </div>

        {selectedFolderId && (
          <button
            onClick={() => {
              setSheetModalName("");
              setShowSheetModal(true);
            }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-bold transition-all text-zinc-300"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500" />
            New Spreadsheet
          </button>
        )}
      </div>

      {/* ── RIGHT PANEL: MAIN SPREADSHEET workspace ──────────────────────────── */}
      <div className="flex-1 bg-[#09090b] border border-[#27272a] rounded-xl flex flex-col overflow-hidden">
        {loadingSheet ? (
          <div className="flex-1 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Reading spreadsheet schema...</p>
          </div>
        ) : !sheetData ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-16 h-16 rounded-full bg-[#1b1b22] border border-[#27272a] flex items-center justify-center shadow-inner">
              <FileSpreadsheet className="w-8 h-8 text-zinc-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">No Sheet Selected</h3>
              <p className="text-xs text-zinc-500 mt-1.5 max-w-sm leading-relaxed">
                Select a spreadsheet from the tree hierarchy on the left, or create a new one under any active folder node.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between border-b border-[#27272a] px-5 py-4 bg-[#09090b]">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-base font-extrabold text-white">{sheetData.name}</h1>
                  <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    Role: {sheetData.permission}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Project Management Spreadsheet Workspace</p>
              </div>

              <div className="flex items-center gap-2">
                {sheetData.permission !== "view" && (
                  <>
                    <button
                      onClick={() => setShowColumnModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs font-bold"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-500" />
                      Add Column
                    </button>
                    <button
                      onClick={handleAddRow}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs font-bold"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-500" />
                      Add Row
                    </button>
                    <button
                      onClick={() => setShowImportModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs font-bold"
                    >
                      <Upload className="w-3.5 h-3.5 text-purple-400" />
                      Import CSV
                    </button>
                  </>
                )}

                <div className="flex items-center border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900">
                  <button
                    onClick={() => handleExportCsv(false)}
                    className="flex items-center gap-1 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs font-bold"
                    title="Export CSV without passwords"
                  >
                    <Download className="w-3.5 h-3.5 text-zinc-400" />
                    Export
                  </button>
                  {sheetData.permission === "manage" && (
                    <button
                      onClick={() => handleExportCsv(true)}
                      className="flex items-center gap-1 px-3 py-1.5 border-l border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-amber-400 transition-all text-xs font-bold"
                      title="Export CSV including decrypted passwords"
                    >
                      <LockKeyhole className="w-3.5 h-3.5 text-amber-500" />
                      Export Decrypted
                    </button>
                  )}
                </div>

                <button
                  onClick={openAuditLogs}
                  className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                  title="Audit Trail logs"
                >
                  <Clock className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* spreadsheet Grid Container */}
            <div className="flex-1 overflow-auto bg-[#040406] pr-1 pb-1">
              {sheetData.columns.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <Database className="w-8 h-8 text-zinc-800 mb-2" />
                  <p className="text-xs text-zinc-500 font-bold">No Columns Defined</p>
                  <p className="text-[10px] text-zinc-600 mt-1 max-w-xs leading-relaxed">
                    Click "Add Column" above to define fields such as Username (text), Passwords (secret), or Date.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse border-spacing-0 select-text">
                  <thead>
                    <tr className="bg-zinc-900/60 sticky top-0 z-10 border-b border-zinc-800">
                      {/* Left delete row handle header */}
                      <th className="w-10 border-r border-zinc-800 text-center text-[10px] text-zinc-500 font-bold uppercase py-2">
                        #
                      </th>
                      {sheetData.columns.map((col) => (
                        <th
                          key={col.id}
                          className="px-4 py-2.5 text-xs font-bold text-zinc-300 uppercase tracking-wider border-r border-b border-zinc-800 min-w-[150px] relative group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{col.name}</span>
                            <span className="text-[9px] lowercase font-normal px-1.5 py-0.5 rounded bg-black/45 border border-white/5 text-zinc-500">
                              {col.type}
                            </span>
                          </div>
                          {sheetData.permission !== "view" && (
                            <button
                              onClick={() => handleDeleteColumn(col.id)}
                              className="absolute top-1/2 -translate-y-1/2 right-2 hidden group-hover:block text-zinc-500 hover:text-red-400 p-0.5 rounded hover:bg-zinc-800 transition-all"
                              title="Delete Column"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetData.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={sheetData.columns.length + 1}
                          className="text-center py-10 text-xs text-zinc-600 font-bold uppercase tracking-wider"
                        >
                          Spreadsheet is empty. Click "Add Row" to append.
                        </td>
                      </tr>
                    ) : (
                      sheetData.rows.map((row, rowIdx) => (
                        <tr
                          key={row.id}
                          className="hover:bg-zinc-900/20 border-b border-zinc-850 group transition-all"
                        >
                          {/* Left delete action column */}
                          <td className="border-r border-zinc-800 text-center text-xs font-bold text-zinc-600 bg-zinc-950/45 py-2">
                            <div className="flex items-center justify-center">
                              {sheetData.permission !== "view" ? (
                                <button
                                  onClick={() => handleDeleteRow(row.id)}
                                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 p-0.5 rounded hover:bg-zinc-800 transition-all"
                                  title="Delete Row"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              ) : (
                                <span>{rowIdx + 1}</span>
                              )}
                            </div>
                          </td>

                          {sheetData.columns.map((col) => {
                            const cell = row.cells.find((c) => c.columnId === col.id);
                            const isEditing =
                              editingCell?.rowId === row.id && editingCell?.columnId === col.id;
                            
                            const cellId = cell?.id || `new-${row.id}-${col.id}`;
                            const isRevealed = !!revealedCells[cellId];
                            const isSecret = col.type === "secret";
                            const hasValue = cell?.hasValue;

                            return (
                              <td
                                key={col.id}
                                className={`px-4 py-2 border-r border-zinc-850 text-xs text-zinc-300 relative min-w-[150px] ${
                                  isEditing ? "bg-zinc-900/60 p-0" : ""
                                }`}
                                onDoubleClick={() =>
                                  handleStartEditCell(row.id, col.id, cell?.value ?? null)
                                }
                              >
                                {isEditing ? (
                                  <div className="flex items-center w-full h-full">
                                    <input
                                      type={isSecret ? "text" : col.type === "date" ? "date" : "text"}
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={() => handleSaveCell(row.id, col.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleSaveCell(row.id, col.id);
                                        if (e.key === "Escape") setEditingCell(null);
                                      }}
                                      autoFocus
                                      className="w-full bg-[#111] text-white px-4 py-2 outline-none border border-blue-500 rounded-sm focus:ring-1 focus:ring-blue-500 font-medium"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2 min-h-[1.5rem]">
                                    <span
                                      className={`truncate max-w-[85%] font-medium ${
                                        isSecret && !isRevealed && hasValue
                                          ? "text-zinc-600 font-mono tracking-widest"
                                          : ""
                                      }`}
                                    >
                                      {isSecret && hasValue
                                        ? isRevealed
                                          ? revealedCells[cellId]
                                          : "••••••"
                                        : cell?.value || ""}
                                    </span>

                                    {isSecret && hasValue && (
                                      <button
                                        onClick={() => handleRevealSecret(cellId)}
                                        className="text-zinc-500 hover:text-blue-400 p-0.5 rounded hover:bg-zinc-800 transition-all flex-shrink-0"
                                        title={isRevealed ? "Hide Password" : "Reveal Decrypted Password"}
                                        disabled={revealingCellId === cellId}
                                      >
                                        {revealingCellId === cellId ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : isRevealed ? (
                                          <EyeOff className="w-3.5 h-3.5 text-blue-500" />
                                        ) : (
                                          <Eye className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                    )}

                                    {isSecret && !hasValue && (
                                      <Lock className="w-3.5 h-3.5 text-zinc-800 flex-shrink-0" />
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL DIALOGS ────────────────────────────────────────────────────── */}

      {/* 1. Create Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-500" />
                {folderModalParentId ? "Create Subfolder" : "Create Folder"}
              </h3>
              <button
                onClick={() => setShowFolderModal(false)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  placeholder="e.g. Creator Account Credentials"
                  value={folderModalName}
                  onChange={(e) => setFolderModalName(e.target.value)}
                  className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500/50"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all"
              >
                Save Folder
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 2. Create Sheet Modal */}
      {showSheetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                New Spreadsheet
              </h3>
              <button
                onClick={() => setShowSheetModal(false)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSheet} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Spreadsheet Name</label>
                <input
                  type="text"
                  placeholder="e.g. TikTok Credentials Sheet"
                  value={sheetModalName}
                  onChange={(e) => setSheetModalName(e.target.value)}
                  className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-emerald-500/50"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all"
              >
                Create Spreadsheet
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 3. Add Column Modal */}
      {showColumnModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-500" />
                Define Column Fields
              </h3>
              <button
                onClick={() => setShowColumnModal(false)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddColumn} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Column Header</label>
                <input
                  type="text"
                  placeholder="e.g. Password"
                  value={columnModalName}
                  onChange={(e) => setColumnModalName(e.target.value)}
                  className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500/50"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Data Type</label>
                <select
                  value={columnModalType}
                  onChange={(e) => setColumnModalType(e.target.value)}
                  className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                >
                  <option value="text">Text (General)</option>
                  <option value="email">Email Address</option>
                  <option value="number">Numeric Value</option>
                  <option value="url">URL Links</option>
                  <option value="secret">Secret (AES Encrypted)</option>
                  <option value="date">Date picker</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all"
              >
                Create Field
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Share Folder Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-blue-500" />
                Folder Sharing settings
              </h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              {/* Existing Permissions list */}
              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-2">Access Rules Configured</label>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {folderAccessList.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">No custom rules. Folder inherits parent ACLs.</p>
                  ) : (
                    folderAccessList.map((access) => {
                      let desc = "";
                      if (access.userId) {
                        const u = usersList.find((usr) => usr.id === access.userId);
                        desc = u ? `${u.name} (${u.email})` : `User ID: ${access.userId}`;
                      } else {
                        const r = rolesList.find((role) => role.key === access.roleKey);
                        desc = r ? `Role: ${r.label}` : `Role Key: ${access.roleKey}`;
                      }
                      
                      return (
                        <div
                          key={access.id}
                          className="flex items-center justify-between bg-zinc-950 border border-zinc-850 p-2.5 rounded-lg"
                        >
                          <div className="text-xs">
                            <p className="font-semibold text-white">{desc}</p>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mt-0.5">
                              Permission: {access.permission}
                            </p>
                          </div>
                          <button
                            onClick={() => handleRevokeShare(access.id)}
                            className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-900 rounded transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Add permission grant */}
              <form onSubmit={handleAddShare} className="border-t border-[#27272a] pt-4 space-y-3">
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="radio"
                      checked={shareTargetType === "user"}
                      onChange={() => {
                        setShareTargetType("user");
                        setShareTargetId("");
                      }}
                      className="accent-blue-500"
                    />
                    Specific Employee
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="radio"
                      checked={shareTargetType === "role"}
                      onChange={() => {
                        setShareTargetType("role");
                        setShareTargetId("");
                      }}
                      className="accent-blue-500"
                    />
                    Group Role
                  </label>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">Select Target</label>
                  {shareTargetType === "user" ? (
                    <select
                      value={shareTargetId}
                      onChange={(e) => setShareTargetId(e.target.value)}
                      className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                    >
                      <option value="">-- Choose User --</option>
                      {usersList.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name || "Unknown"} ({u.email})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={shareTargetId}
                      onChange={(e) => setShareTargetId(e.target.value)}
                      className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                    >
                      <option value="">-- Choose Role --</option>
                      {rolesList.map((r) => (
                        <option key={r.id} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">Access Level</label>
                    <select
                      value={sharePermission}
                      onChange={(e) => setSharePermission(e.target.value as any)}
                      className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                    >
                      <option value="view">View</option>
                      <option value="edit">Edit</option>
                      <option value="manage">Manage</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={!shareTargetId}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Add Grant
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 5. CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-purple-400" />
                Import CSV Dataset
              </h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* File Upload Area */}
              {!importCsvData ? (
                <div className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-2xl p-8 text-center bg-zinc-950/20 cursor-pointer transition-all relative">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvFileSelected(file);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <FileSpreadsheet className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs text-zinc-400 font-bold">Drag and Drop CSV File</p>
                  <p className="text-[10px] text-zinc-500 mt-1">Accepts standard .csv files up to 5MB</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* File status */}
                  <div className="flex items-center justify-between bg-zinc-950 p-3 rounded-lg border border-zinc-850">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <p className="text-xs font-semibold text-white">CSV File Loaded Successfully</p>
                    </div>
                    <button
                      onClick={() => setImportCsvData("")}
                      className="text-xs text-red-400 font-bold hover:underline"
                    >
                      Clear File
                    </button>
                  </div>

                  {/* Header Mapping Setup */}
                  <div>
                    <h4 className="text-[10px] uppercase font-bold text-zinc-500 mb-2">Map CSV Headers to Vault Columns</h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                      {importHeaders.map((header) => {
                        const current = importMapping[header] || { isNew: true, newName: header, newType: "text" };
                        return (
                          <div
                            key={header}
                            className="bg-zinc-950 p-3 border border-zinc-850 rounded-lg space-y-2.5"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <p className="text-xs font-bold text-white truncate max-w-[40%]">CSV: "{header}"</p>
                              
                              <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={!current.isNew}
                                    onChange={() => {
                                      setImportMapping((prev) => ({
                                        ...prev,
                                        [header]: { ...current, isNew: false },
                                      }));
                                    }}
                                    className="accent-blue-500"
                                    disabled={sheetData?.columns.length === 0}
                                  />
                                  Existing Field
                                </label>
                                <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={current.isNew}
                                    onChange={() => {
                                      setImportMapping((prev) => ({
                                        ...prev,
                                        [header]: { ...current, isNew: true },
                                      }));
                                    }}
                                    className="accent-blue-500"
                                  />
                                  Create New Field
                                </label>
                              </div>
                            </div>

                            {current.isNew ? (
                              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-900/60">
                                <div>
                                  <label className="block text-[8px] uppercase font-bold text-zinc-600 mb-1">New Field Name</label>
                                  <input
                                    type="text"
                                    value={current.newName}
                                    onChange={(e) => {
                                      setImportMapping((prev) => ({
                                        ...prev,
                                        [header]: { ...current, newName: e.target.value },
                                      }));
                                    }}
                                    className="w-full bg-[#111] border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-semibold text-white focus:outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[8px] uppercase font-bold text-zinc-600 mb-1">New Data Type</label>
                                  <select
                                    value={current.newType}
                                    onChange={(e) => {
                                      setImportMapping((prev) => ({
                                        ...prev,
                                        [header]: { ...current, newType: e.target.value },
                                      }));
                                    }}
                                    className="w-full bg-[#111] border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-semibold text-zinc-300 focus:outline-none"
                                  >
                                    <option value="text">Text (General)</option>
                                    <option value="email">Email</option>
                                    <option value="number">Number</option>
                                    <option value="url">URL Link</option>
                                    <option value="secret">Secret (AES Encrypted)</option>
                                    <option value="date">Date</option>
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div className="pt-2 border-t border-zinc-900/60">
                                <label className="block text-[8px] uppercase font-bold text-zinc-600 mb-1">Choose Destination Column</label>
                                <select
                                  value={current.columnId}
                                  onChange={(e) => {
                                    setImportMapping((prev) => ({
                                      ...prev,
                                      [header]: { ...current, columnId: e.target.value },
                                    }));
                                  }}
                                  className="w-full bg-[#111] border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-semibold text-zinc-300 focus:outline-none"
                                >
                                  <option value="">-- Select Column --</option>
                                  {sheetData?.columns.map((col) => (
                                    <option key={col.id} value={col.id}>
                                      {col.name} ({col.type})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mode & Submit details */}
                  <div className="grid grid-cols-2 gap-4 border-t border-[#27272a] pt-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">Import Behavior</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                          <input
                            type="radio"
                            checked={importMode === "append"}
                            onChange={() => setImportMode("append")}
                            className="accent-blue-500"
                          />
                          Append Rows
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                          <input
                            type="radio"
                            checked={importMode === "replace"}
                            onChange={() => setImportMode("replace")}
                            className="accent-blue-500"
                          />
                          Replace Data
                        </label>
                      </div>
                    </div>

                    <div className="flex items-end">
                      <button
                        onClick={handleImportSubmit}
                        disabled={importing}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {importing ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" />
                            Run Import
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Audit Trail Logs Modal */}
      {showAuditLogs && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                Data Vault Audit Logs
              </h3>
              <button
                onClick={() => setShowAuditLogs(false)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[#040406]">
              {loadingAuditLogs ? (
                <div className="flex flex-col items-center justify-center h-48 space-y-2">
                  <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase">Loading log events...</p>
                </div>
              ) : auditLogs.length === 0 ? (
                <p className="text-zinc-500 text-xs italic text-center py-10">No audit logs logged in database.</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-zinc-950 border border-zinc-850 p-3 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-zinc-500 text-[10px] font-bold">
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                        <span className="uppercase text-blue-400 bg-blue-950/45 px-1.5 py-0.5 rounded border border-blue-900/25">
                          {log.action}
                        </span>
                      </div>
                      <p className="text-zinc-300 font-semibold">{log.target}</p>
                      <p className="text-[10px] text-zinc-500">
                        Triggered by: {log.userEmail || "System/Unknown"} ({log.userId || "N/A"})
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
