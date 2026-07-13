"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ManagedAccountEditForm from "@/components/ManagedAccountEditForm";
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
  Sparkles,
  Search
} from "lucide-react";
import { toast } from "sonner";
import {
  DataEditor,
  GridColumn,
  GridCell,
  GridCellKind,
  GridSelection,
  EditableGridCell,
  Rectangle,
  CompactSelection
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";

interface FolderNode {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdBy: string | null;
  createdAt: string;
  permission: "view" | "edit" | "manage";
  sheets: { id: string; name: string; createdAt: string }[];
  accessList?: any[];
  ownerUserId?: string | null;
}

interface SheetData {
  id: string;
  name: string;
  folderId: string;
  permission: "view" | "edit" | "manage";
  frozenRows: number;
  frozenCols: number;
  colorRules: any;
  viewState: any;
  columns: { id: string; name: string; type: string; order: number; width?: number; hidden?: boolean; pinned?: boolean; config?: any }[];
  rows: {
    id: string;
    order: number;
    height?: number;
    color?: string | null;
    cells: {
      id: string;
      rowId: string;
      columnId: string;
      value: string | null;
      isSecret: boolean;
      hasValue: boolean;
      managedAccountId?: string | null;
      managedAccount?: any | null;
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
  userRole,
  hasAccountsEditAccess,
}: {
  currentUserId: string;
  userRole: string;
  hasAccountsEditAccess: boolean;
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

  // Sheets 2.0 State
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<any>(null);
  const [gridSelection, setGridSelection] = useState<GridSelection>({
    current: undefined,
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  });
  
  const [activeDropdown, setActiveDropdown] = useState<{
    rowId: string;
    columnId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    options: Array<{ id: string; label: string; color: string }>;
    isTags: boolean;
    value: string;
  } | null>(null);

  const [headerMenu, setHeaderMenu] = useState<{
    colIdx: number;
    bounds: Rectangle;
  } | null>(null);

  // Undo/Redo Stacks
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  // Search State
  const [searchTerm, setSearchTerm] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);
  const [pendingFocusCell, setPendingFocusCell] = useState<{ rowId: string; columnId: string } | null>(null);

  // Options configuration modal
  const [showConfigModal, setShowConfigModal] = useState<string | null>(null); // columnId
  const [configOptions, setConfigOptions] = useState<Array<{ id: string; label: string; color: string }>>([]);
  const [trackEnabled, setTrackEnabled] = useState(false);
  const [successOptionIds, setSuccessOptionIds] = useState<string[]>([]);
  const [failOptionIds, setFailOptionIds] = useState<string[]>([]);

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

  // Account popup & picker states
  const [activeAccountPopup, setActiveAccountPopup] = useState<{
    rowId: string;
    columnId: string;
    accountId: string;
    cellId: string;
  } | null>(null);

  const [activeAccountPicker, setActiveAccountPicker] = useState<{
    rowId: string;
    columnId: string;
    cellId: string;
  } | null>(null);

  const [allManagedAccounts, setAllManagedAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountPickerSearch, setAccountPickerSearch] = useState("");

  // Fetch managed accounts when picker is opened
  useEffect(() => {
    if (activeAccountPicker) {
      const fetchAccounts = async () => {
        setLoadingAccounts(true);
        try {
          const res = await fetch("/api/managed/accounts/all");
          if (res.ok) {
            const data = await res.json();
            setAllManagedAccounts(data || []);
          }
        } catch (err) {
          console.warn("Failed to load managed accounts for picker:", err);
        } finally {
          setLoadingAccounts(false);
        }
      };
      fetchAccounts();
    }
  }, [activeAccountPicker]);

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

  const handleSetFolderOwner = async (folderId: string, ownerUserId: string | null) => {
    try {
      const res = await fetch("/api/managed/vault/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId,
          ownerUserId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign owner");

      toast.success("Folder owner updated successfully");
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || "Failed to update folder owner");
    }
  };

  const handleUpdateExistingAccess = async (access: any, newPermission: string) => {
    if (!shareModalFolderId) return;

    try {
      const payload: any = {
        folderId: shareModalFolderId,
        permission: newPermission,
      };
      if (access.userId) payload.userId = access.userId;
      else payload.roleKey = access.roleKey;

      const res = await fetch("/api/managed/vault/folders/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update access level");

      toast.success("Permission updated successfully");
      
      // Update local state list
      setFolderAccessList((prev) =>
        prev.map((item) => (item.id === access.id ? { ...item, permission: newPermission } : item))
      );
      
      // Reload folders to propagate changes
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || "Failed to update access level");
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

  // ── SPREADSHEET 2.0 UTILITIES ──────────────────────────────────────────────

  const pushHistory = (prevState: { columns: any[]; rows: any[]; frozenRows: number; frozenCols: number }) => {
    setUndoStack((prev) => [...prev, prevState]);
    setRedoStack([]);
  };

  const persistGridStateToDb = async (state: any) => {
    if (!selectedSheetId) return;
    try {
      const updates = [];
      for (const row of state.rows) {
        for (const cell of row.cells) {
          updates.push({
            rowId: row.id,
            columnId: cell.columnId,
            value: cell.value,
          });
        }
      }
      if (updates.length > 0) {
        await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
      }
      for (const col of state.columns) {
        await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            columnId: col.id,
            width: col.width,
            order: col.order,
            hidden: col.hidden,
            pinned: col.pinned,
            config: col.config,
            type: col.type,
          }),
        });
      }
    } catch (e) {
      console.error("Failed to persist grid state to database:", e);
    }
  };

  const handleHeaderMenuClick = useCallback((col: number, bounds: Rectangle) => {
    setHeaderMenu({ colIdx: col, bounds });
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !sheetData) return;
    const prev = undoStack[undoStack.length - 1];

    setRedoStack((stack) => [
      ...stack,
      {
        columns: sheetData.columns,
        rows: sheetData.rows,
        frozenRows: sheetData.frozenRows,
        frozenCols: sheetData.frozenCols,
      },
    ]);

    setSheetData((prevData: any) => ({
      ...prevData,
      columns: prev.columns,
      rows: prev.rows,
      frozenRows: prev.frozenRows,
      frozenCols: prev.frozenCols,
    }));

    setUndoStack((stack) => stack.slice(0, -1));
    toast.success("Undo action applied");
    persistGridStateToDb(prev);
  }, [undoStack, sheetData, selectedSheetId]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !sheetData) return;
    const next = redoStack[redoStack.length - 1];

    setUndoStack((stack) => [
      ...stack,
      {
        columns: sheetData.columns,
        rows: sheetData.rows,
        frozenRows: sheetData.frozenRows,
        frozenCols: sheetData.frozenCols,
      },
    ]);

    setSheetData((prevData: any) => ({
      ...prevData,
      columns: next.columns,
      rows: next.rows,
      frozenRows: next.frozenRows,
      frozenCols: next.frozenCols,
    }));

    setRedoStack((stack) => stack.slice(0, -1));
    toast.success("Redo action applied");
    persistGridStateToDb(next);
  }, [redoStack, sheetData, selectedSheetId]);

  // keydown listeners for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sheetData, undoStack, redoStack, handleUndo, handleRedo]);

  // Global Search matcher focus scroll handler
  useEffect(() => {
    if (selectedSheetId && sheetData && pendingFocusCell) {
      const { rowId, columnId } = pendingFocusCell;
      const visibleCols = sheetData.columns.filter((c) => !c.hidden);
      const colIdx = visibleCols.findIndex((c) => c.id === columnId);
      const rowIdx = sheetData.rows.findIndex((r) => r.id === rowId);

      if (colIdx !== -1 && rowIdx !== -1) {
        setGridSelection({
          current: {
            cell: [colIdx, rowIdx] as any,
            range: { x: colIdx, y: rowIdx, width: 1, height: 1 },
            rangeStack: [],
          },
          rows: CompactSelection.empty(),
          columns: CompactSelection.empty(),
        });
        
        setTimeout(() => {
          gridRef.current?.scrollTo?.(colIdx, rowIdx);
        }, 150);
      }
      setPendingFocusCell(null);
    }
  }, [sheetData, selectedSheetId, pendingFocusCell]);

  const handleGlobalSearch = async (val: string) => {
    setGlobalSearchQuery(val);
    if (!val.trim()) {
      setGlobalSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/managed/vault/search?q=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (res.ok) {
        setGlobalSearchResults(data.results || []);
      }
    } catch (e) {
      console.warn("Global search error:", e);
    }
  };

  const handleSelectSearchResult = (result: any) => {
    setSelectedSheetId(result.sheetId);
    setSearchTerm(globalSearchQuery);
    if (result.rowId && result.columnId) {
      setPendingFocusCell({
        rowId: result.rowId,
        columnId: result.columnId,
      });
    }
  };

  const getSelectedRowIds = useCallback((): string[] => {
    if (!sheetData) return [];
    const rowIds: string[] = [];
    for (const idx of gridSelection.rows) {
      const r = sheetData.rows[idx];
      if (r) rowIds.push(r.id);
    }
    if (rowIds.length === 0 && gridSelection.current) {
      const r = sheetData.rows[gridSelection.current.cell[1]];
      if (r) rowIds.push(r.id);
    }
    return rowIds;
  }, [sheetData, gridSelection]);

  const handleUpdateSelectedRowsColor = async (color: string) => {
    if (!selectedSheetId || !sheetData) return;
    const rowIds = getSelectedRowIds();
    if (rowIds.length === 0) {
      toast.warning("No rows selected");
      return;
    }
    try {
      setSheetData((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r: any) =>
            rowIds.includes(r.id) ? { ...r, color } : r
          ),
        };
      });
      for (const rowId of rowIds) {
        await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId, color }),
        });
      }
      toast.success("Rows color updated");
    } catch (err: any) {
      toast.error("Failed to update row color");
    }
  };

  const handleUpdateSelectedRowsHeight = async (height: number) => {
    if (!selectedSheetId || !sheetData) return;
    const rowIds = getSelectedRowIds();
    if (rowIds.length === 0) {
      toast.warning("No rows selected");
      return;
    }
    try {
      setSheetData((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r: any) =>
            rowIds.includes(r.id) ? { ...r, height } : r
          ),
        };
      });
      for (const rowId of rowIds) {
        await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId, height }),
        });
      }
      toast.success("Rows height updated");
    } catch (err: any) {
      toast.error("Failed to update row height");
    }
  };

  const handleRenameColumn = async (columnId: string, newName: string) => {
    if (!selectedSheetId) return;
    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, name: newName }),
      });
      if (!res.ok) throw new Error("Rename failed");
      toast.success("Column renamed");
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to rename column");
    }
  };

  const handleTogglePinColumn = async (columnId: string, pinned: boolean) => {
    if (!selectedSheetId) return;
    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, pinned }),
      });
      if (!res.ok) throw new Error("Pin update failed");
      toast.success(pinned ? "Column pinned" : "Column unpinned");
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update pin");
    }
  };

  const handleToggleHideColumn = async (columnId: string, hidden: boolean) => {
    if (!selectedSheetId) return;
    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, hidden }),
      });
      if (!res.ok) throw new Error("Hide update failed");
      toast.success(hidden ? "Column hidden" : "Column shown");
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update hidden state");
    }
  };

  const handleUpdateSheetSettings = async (settings: any) => {
    if (!selectedSheetId) return;
    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to update sheet settings");
      toast.success("Sheet view settings saved");
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update sheet settings");
    }
  };

  const handleSaveColumnConfig = async (columnId: string, options: any[]) => {
    if (!selectedSheetId) return;
    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnId,
          config: { options },
          trackConfig: {
            enabled: trackEnabled,
            successOptionIds,
            failOptionIds,
          },
        }),
      });
      if (!res.ok) throw new Error("Config save failed");
      toast.success("Column options and tracking updated");
      setShowConfigModal(null);
      fetchSheet(selectedSheetId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update options config");
    }
  };

  const openConfigModal = (columnId: string) => {
    const col = sheetData?.columns.find((c) => c.id === columnId);
    if (col) {
      const config = col.config as any;
      const track = (col as any).trackConfig as any;
      setConfigOptions(config?.options || []);
      setTrackEnabled(track?.enabled || false);
      setSuccessOptionIds(track?.successOptionIds || []);
      setFailOptionIds(track?.failOptionIds || []);
      setShowConfigModal(columnId);
    }
  };

  // ── OPTIMISTIC GRID WRITES ────────────────────────────────────────────────

  const handleUpdateCellOptimistic = async (rowId: string, columnId: string, value: string) => {
    if (!sheetData || !selectedSheetId) return;

    const prevRows = JSON.parse(JSON.stringify(sheetData.rows));
    pushHistory({
      columns: sheetData.columns,
      rows: prevRows,
      frozenRows: sheetData.frozenRows,
      frozenCols: sheetData.frozenCols,
    });

    setSheetData((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r: any) => {
          if (r.id !== rowId) return r;
          
          let cellExists = false;
          const updatedCells = r.cells.map((c: any) => {
            if (c.columnId !== columnId) return c;
            cellExists = true;
            const column = prev.columns.find((col: any) => col.id === columnId);
            const isSecret = column?.type === "secret";
            return {
              ...c,
              value: isSecret ? "••••••" : value,
              isSecret,
              hasValue: value.trim() !== "",
            };
          });

          if (!cellExists) {
            const column = prev.columns.find((col: any) => col.id === columnId);
            const isSecret = !!(column?.type === "secret");
            updatedCells.push({
              id: `temp-${rowId}-${columnId}`,
              rowId,
              columnId,
              value: isSecret ? "••••••" : value,
              isSecret,
              hasValue: value.trim() !== "",
            });
          }

          return {
            ...r,
            cells: updatedCells,
          };
        }),
      };
    });

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/cells`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId,
          columnId,
          value,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch (err) {
      toast.error("Failed to save cell value");
      setSheetData((prev: any) => {
        if (!prev) return prev;
        return { ...prev, rows: prevRows };
      });
    }
  };

  const handleCellEdited = useCallback(
    (cell: readonly [number, number], newValue: EditableGridCell) => {
      if (!sheetData || sheetData.permission === "view") return;
      const [colIdx, rowIdx] = cell;
      const visibleCols = sheetData.columns.filter((c) => !c.hidden);
      const col = visibleCols[colIdx];
      const row = sheetData.rows[rowIdx];
      if (!col || !row) return;

      if (newValue.kind === GridCellKind.Text) {
        handleUpdateCellOptimistic(row.id, col.id, newValue.data);
      }
    },
    [sheetData, selectedSheetId]
  );

  const handleColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      if (!selectedSheetId) return;
      setSheetData((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          columns: prev.columns.map((c: any) =>
            c.id === column.id ? { ...c, width: newSize } : c
          ),
        };
      });
      fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnId: column.id,
          width: newSize,
        }),
      });
    },
    [selectedSheetId]
  );

  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!sheetData || !selectedSheetId) return;
      const newCols = [...sheetData.columns];
      const [removed] = newCols.splice(startIndex, 1);
      newCols.splice(endIndex, 0, removed);
      
      const updatedCols = newCols.map((c, idx) => ({ ...c, order: idx }));
      
      setSheetData((prev: any) => {
        if (!prev) return prev;
        return { ...prev, columns: updatedCols };
      });

      for (const col of updatedCols) {
        fetch(`/api/managed/vault/sheets/${selectedSheetId}/columns`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            columnId: col.id,
            order: col.order,
          }),
        });
      }
    },
    [sheetData, selectedSheetId]
  );

  const handleFillPattern = useCallback(
    (args: any) => {
      if (!sheetData || sheetData.permission === "view") return;
      const { patternSource, fillDestination } = args;

      args.preventDefault();

      const updates: Array<{ rowId: string; columnId: string; value: string }> = [];
      const updatedRows = [...sheetData.rows];

      for (let x = fillDestination.x; x < fillDestination.x + fillDestination.width; x++) {
        const visibleCols = sheetData.columns.filter((c) => !c.hidden);
        const col = visibleCols[x];
        if (!col) continue;

        const sourceColIdx = patternSource.x + ((x - fillDestination.x) % patternSource.width);
        const sourceCol = visibleCols[sourceColIdx];
        if (!sourceCol) continue;

        for (let y = fillDestination.y; y < fillDestination.y + fillDestination.height; y++) {
          const row = sheetData.rows[y];
          if (!row) continue;

          const sourceRowIdx = patternSource.y + ((y - fillDestination.y) % patternSource.height);
          const sourceRow = sheetData.rows[sourceRowIdx];
          if (!sourceRow) continue;

          const sourceCell = sourceRow.cells.find((c: any) => c.columnId === sourceCol.id);
          const val = sourceCell?.value || "";

          updates.push({
            rowId: row.id,
            columnId: col.id,
            value: val,
          });

          const rowIndex = updatedRows.findIndex((r) => r.id === row.id);
          if (rowIndex !== -1) {
            const cells = [...updatedRows[rowIndex].cells];
            const cellIdx = cells.findIndex((c) => c.columnId === col.id);
            const isSecret = col.type === "secret";
            if (cellIdx !== -1) {
              cells[cellIdx] = { ...cells[cellIdx], value: isSecret ? "••••••" : val, isSecret, hasValue: val.trim() !== "" };
            } else {
              cells.push({
                id: `temp-${row.id}-${col.id}`,
                rowId: row.id,
                columnId: col.id,
                value: isSecret ? "••••••" : val,
                isSecret,
                hasValue: val.trim() !== "",
              });
            }
            updatedRows[rowIndex] = { ...updatedRows[rowIndex], cells };
          }
        }
      }

      setSheetData((prev: any) => {
        if (!prev) return prev;
        return { ...prev, rows: updatedRows };
      });

      fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      }).catch((e) => {
        toast.error("Failed to persist drag-fill values");
      });
    },
    [sheetData, selectedSheetId]
  );

  const handleCopyWithSecrets = async () => {
    if (!sheetData || !selectedSheetId) return;

    let range = gridSelection.current?.range;
    if (!range) {
      toast.warning("Please select a range of cells first");
      return;
    }

    const visibleCols = sheetData.columns.filter((c) => !c.hidden);
    const cellIds: string[] = [];
    for (let x = range.x; x < range.x + range.width; x++) {
      const col = visibleCols[x];
      if (!col) continue;
      for (let y = range.y; y < range.y + range.height; y++) {
        const row = sheetData.rows[y];
        if (!row) continue;
        const cell = row.cells.find((c) => c.columnId === col.id);
        if (cell?.id) {
          cellIds.push(cell.id);
        }
      }
    }

    if (cellIds.length === 0) {
      toast.warning("No cell data selected");
      return;
    }

    try {
      const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/copy-secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to copy secrets");

      const decrypted = data.decryptedCells;

      let tsvLines = [];
      for (let y = range.y; y < range.y + range.height; y++) {
        const row = sheetData.rows[y];
        if (!row) continue;
        let tsvRow = [];
        for (let x = range.x; x < range.x + range.width; x++) {
          const col = visibleCols[x];
          if (!col) continue;
          const cell = row.cells.find((c) => c.columnId === col.id);
          const val = cell ? (decrypted[cell.id] ?? cell.value ?? "") : "";
          tsvRow.push(val);
        }
        tsvLines.push(tsvRow.join("\t"));
      }

      const tsvString = tsvLines.join("\n");
      await navigator.clipboard.writeText(tsvString);
      toast.success("Copied to clipboard (including decrypted secrets)");
    } catch (err: any) {
      toast.error(err.message || "Failed to copy secrets");
    }
  };

  const handlePaste = useCallback(
    (target: readonly [number, number], values: readonly (readonly string[])[]) => {
      if (!sheetData || !selectedSheetId || sheetData.permission === "view") return false;

      const [startCol, startRow] = target;
      const updates: Array<{ rowId: string; columnId: string; value: string }> = [];
      const updatedRows = [...sheetData.rows];

      const finalRequiredRowsCount = startRow + values.length;
      const neededRowsCount = finalRequiredRowsCount - updatedRows.length;

      const runPasteSync = async () => {
        if (neededRowsCount > 0) {
          await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows/bulk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addRowsCount: neededRowsCount }),
          });
          await fetchSheet(selectedSheetId);
          return;
        }

        for (let r = 0; r < values.length; r++) {
          const rowIdx = startRow + r;
          const row = sheetData.rows[rowIdx];
          if (!row) continue;

          for (let c = 0; c < values[r].length; c++) {
            const colIdx = startCol + c;
            const visibleCols = sheetData.columns.filter((co) => !co.hidden);
            const col = visibleCols[colIdx];
            if (!col) continue;

            const val = values[r][c];
            updates.push({
              rowId: row.id,
              columnId: col.id,
              value: val,
            });

            const rowIndex = updatedRows.findIndex((item) => item.id === row.id);
            if (rowIndex !== -1) {
              const cells = [...updatedRows[rowIndex].cells];
              const cellIdx = cells.findIndex((cellItem) => cellItem.columnId === col.id);
              const isSecret = col.type === "secret";
              if (cellIdx !== -1) {
                cells[cellIdx] = { ...cells[cellIdx], value: isSecret ? "••••••" : val, isSecret, hasValue: val.trim() !== "" };
              } else {
                cells.push({
                  id: `temp-${row.id}-${col.id}`,
                  rowId: row.id,
                  columnId: col.id,
                  value: isSecret ? "••••••" : val,
                  isSecret,
                  hasValue: val.trim() !== "",
                });
              }
              updatedRows[rowIndex] = { ...updatedRows[rowIndex], cells };
            }
          }
        }

        setSheetData((prev: any) => {
          if (!prev) return prev;
          return { ...prev, rows: updatedRows };
        });

        await fetch(`/api/managed/vault/sheets/${selectedSheetId}/rows/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
      };

      runPasteSync().catch(() => {
        toast.error("Failed to paste data values");
      });

      return false;
    },
    [sheetData, selectedSheetId]
  );

  const handleCellClicked = useCallback(
    (cell: readonly [number, number], event: any) => {
      if (!sheetData) return;
      const [colIdx, rowIdx] = cell;
      const visibleCols = sheetData.columns.filter((c) => !c.hidden);
      const col = visibleCols[colIdx];
      const row = sheetData.rows[rowIdx];
      if (!col || !row) return;

      const cellData = row.cells.find((c) => c.columnId === col.id);
      const cellId = cellData?.id || `new-${row.id}-${col.id}`;

      if (col.type === "secret" && cellData?.hasValue) {
        const clickX = event.localX;
        if (clickX > event.bounds.width - 32) {
          handleRevealSecret(cellId);
          return;
        }
      }

      if ((col.type === "status" || col.type === "tags") && sheetData.permission !== "view") {
        const config = col.config as any;
        const options = config?.options || [];
        
        setActiveDropdown({
          rowId: row.id,
          columnId: col.id,
          x: event.bounds.x,
          y: event.bounds.y,
          width: event.bounds.width,
          height: event.bounds.height,
          options,
          isTags: col.type === "tags",
          value: cellData?.value || "",
        });
      }

      if (col.type === "account_link") {
        const hasAccount = cellData?.managedAccountId;
        if (hasAccount) {
          setActiveAccountPopup({
            rowId: row.id,
            columnId: col.id,
            accountId: cellData.managedAccountId as string,
            cellId,
          });
        } else {
          if (sheetData.permission !== "view") {
            setActiveAccountPicker({
              rowId: row.id,
              columnId: col.id,
              cellId,
            });
          }
        }
      }
    },
    [sheetData, handleRevealSecret, setActiveAccountPopup, setActiveAccountPicker]
  );

  const getRowHeight = useCallback((rowIdx: number): number => {
    if (!sheetData) return 34;
    return sheetData.rows[rowIdx]?.height || 34;
  }, [sheetData]);

  const gridColumns = useMemo<GridColumn[]>(() => {
    if (!sheetData) return [];
    return sheetData.columns.filter((c) => !c.hidden).map((col) => ({
      title: col.name,
      width: col.width || 150,
      id: col.id,
      hasMenu: true,
    }));
  }, [sheetData]);

  const getCellContent = useCallback(
    (cell: readonly [number, number]): GridCell => {
      const [colIdx, rowIdx] = cell;
      if (!sheetData) {
        return {
          kind: GridCellKind.Loading,
          allowOverlay: false,
        };
      }
      
      const col = sheetData.columns.filter((c) => !c.hidden)[colIdx];
      const row = sheetData.rows[rowIdx];
      if (!col || !row) {
        return {
          kind: GridCellKind.Loading,
          allowOverlay: false,
        };
      }

      const cellData = row.cells.find((c) => c.columnId === col.id);
      const isSecret = col.type === "secret";
      const cellId = cellData?.id || `new-${row.id}-${col.id}`;
      const isRevealed = !!revealedCells[cellId];
      const hasValue = cellData?.hasValue;

      let displayVal = "";
      if (isSecret && hasValue) {
        displayVal = isRevealed ? (revealedCells[cellId] || "") : "••••••";
      } else {
        displayVal = cellData?.value || "";
      }

      const isMatch = searchTerm && displayVal.toLowerCase().includes(searchTerm.toLowerCase());

      return {
        kind: GridCellKind.Text,
        data: displayVal,
        displayData: displayVal,
        allowOverlay: col.type !== "account_link" && col.type !== "tags" && col.type !== "status",
        readonly: sheetData.permission === "view" || col.type === "account_link" || col.type === "tags" || col.type === "status",
        themeOverride: isMatch ? {
          bgCell: "#fef08a",
          textDark: "#854d0e",
        } : undefined,
      };
    },
    [sheetData, revealedCells, searchTerm]
  );

  const handleDrawCell = useCallback(
    (args: any, drawContent: () => void) => {
      const { ctx, rect, col, row } = args;
      if (!sheetData) return drawContent();

      const columnsList = sheetData.columns.filter((c) => !c.hidden);
      const column = columnsList[col];
      const rowData = sheetData.rows[row];
      if (!column || !rowData) return drawContent();

      if (rowData.color) {
        ctx.fillStyle = rowData.color + "1a";
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }

      const cellData = rowData.cells.find((c: any) => c.columnId === column.id);
      const cellId = cellData?.id || `new-${rowData.id}-${column.id}`;

      if (column.type === "status" && cellData?.value) {
        const config = column.config as any;
        const option = config?.options?.find((opt: any) => opt.id === cellData.value || opt.label === cellData.value);
        if (option) {
          ctx.save();
          ctx.beginPath();
          const padX = 8;
          const padY = 5;
          const x = rect.x + padX;
          const y = rect.y + padY;
          const w = rect.width - padX * 2;
          const h = rect.height - padY * 2;
          const radius = 6;
          
          if (ctx.roundRect) {
            ctx.roundRect(x, y, w, h, radius);
          } else {
            ctx.rect(x, y, w, h);
          }
          ctx.fillStyle = option.color + "22";
          ctx.fill();

          ctx.strokeStyle = option.color + "44";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = option.color;
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(option.label, x + w / 2, y + h / 2);
          ctx.restore();
          return;
        }
      }

      if (column.type === "tags" && cellData?.value) {
        const config = column.config as any;
        const selectedIds = cellData.value.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (selectedIds.length > 0) {
          ctx.save();
          let currentX = rect.x + 6;
          const padY = 5;
          const h = rect.height - padY * 2;
          const radius = 4;

          for (const id of selectedIds) {
            const option = config?.options?.find((opt: any) => opt.id === id || opt.label === id);
            if (!option) continue;

            ctx.font = "bold 10px Inter, sans-serif";
            const textWidth = ctx.measureText(option.label).width;
            const w = textWidth + 12;

            if (currentX + w > rect.x + rect.width - 6) break;

            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(currentX, rect.y + padY, w, h, radius);
            } else {
              ctx.rect(currentX, rect.y + padY, w, h);
            }
            ctx.fillStyle = option.color + "22";
            ctx.fill();
            ctx.strokeStyle = option.color + "33";
            ctx.stroke();

            ctx.fillStyle = option.color;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(option.label, currentX + w / 2, rect.y + padY + h / 2);

            currentX += w + 4;
          }
          ctx.restore();
          return;
        }
      }

      if (column.type === "account_link") {
        ctx.save();
        const hasAccount = cellData?.managedAccountId;
        const username = cellData?.value || "";

        const padY = 5;
        const h = rect.height - padY * 2;
        const radius = 6;
        
        ctx.beginPath();
        const pillWidth = rect.width - 32;
        if (ctx.roundRect) {
          ctx.roundRect(rect.x + 8, rect.y + padY, pillWidth, h, radius);
        } else {
          ctx.rect(rect.x + 8, rect.y + padY, pillWidth, h);
        }
        
        if (hasAccount) {
          ctx.fillStyle = "#8b5cf615";
          ctx.fill();
          ctx.strokeStyle = "#8b5cf630";
          ctx.stroke();

          ctx.fillStyle = "#a78bfa";
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          let displayUser = username;
          if (ctx.measureText(displayUser).width > pillWidth - 16) {
            while (displayUser.length > 0 && ctx.measureText(displayUser + "...").width > pillWidth - 16) {
              displayUser = displayUser.slice(0, -1);
            }
            displayUser += "...";
          }
          ctx.fillText(displayUser, rect.x + 16, rect.y + rect.height / 2);
        } else {
          ctx.fillStyle = "#3f3f4615";
          ctx.fill();
          ctx.strokeStyle = "#3f3f4630";
          ctx.stroke();

          ctx.fillStyle = "#a1a1aa";
          ctx.font = "italic 11px Inter, sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText("Link account...", rect.x + 16, rect.y + rect.height / 2);
        }

        ctx.fillStyle = hasAccount ? "#3b82f6" : "#10b981";
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(hasAccount ? "Edit" : "Link", rect.x + rect.width - 8, rect.y + rect.height / 2);

        ctx.restore();
        return;
      }

      if (column.type === "secret") {
        const isRevealed = !!revealedCells[cellId];
        const hasValue = cellData?.hasValue;

        if (hasValue) {
          ctx.save();
          ctx.fillStyle = isRevealed ? "#d4d4d8" : "#52525b";
          ctx.font = isRevealed ? "12px Inter, sans-serif" : "bold 16px Inter, sans-serif";
          ctx.textBaseline = "middle";
          const text = isRevealed ? (revealedCells[cellId] || "") : "••••••";
          ctx.fillText(text, rect.x + 12, rect.y + rect.height / 2);

          const iconX = rect.x + rect.width - 24;
          ctx.fillStyle = isRevealed ? "#3b82f6" : "#71717a";
          ctx.font = "11px Inter, sans-serif";
          ctx.fillText(isRevealed ? "👁️" : "👁️‍🗨️", iconX, rect.y + rect.height / 2);
          ctx.restore();
          return;
        }
      }

      drawContent();
    },
    [sheetData, revealedCells]
  );

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

        <div className="relative">
          <input
            type="text"
            placeholder="Search vault..."
            value={globalSearchQuery}
            onChange={(e) => handleGlobalSearch(e.target.value)}
            className="w-full bg-[#111] border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/50"
          />
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          {globalSearchQuery && (
            <button
              onClick={() => {
                setGlobalSearchQuery("");
                setGlobalSearchResults([]);
              }}
              className="text-zinc-500 hover:text-white absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold"
            >
              ×
            </button>
          )}
        </div>

        {globalSearchQuery ? (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Search Results ({globalSearchResults.length})</span>
            </div>
            {globalSearchResults.length === 0 ? (
              <p className="text-xs text-zinc-500 italic p-2 text-center">No matches found</p>
            ) : (
              globalSearchResults.map((res: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => handleSelectSearchResult(res)}
                  className="p-2.5 rounded-lg border border-zinc-850 bg-zinc-950/40 hover:bg-zinc-900/60 transition-all cursor-pointer space-y-1 text-[11px]"
                >
                  <div className="flex items-center justify-between font-bold text-[9px] text-zinc-500 uppercase">
                    <span>{res.matchType}</span>
                    <span className="text-blue-500">{res.folderName}</span>
                  </div>
                  <p className="font-semibold text-white truncate">{res.sheetName}</p>
                  <p className="text-[10px] text-zinc-400 italic font-mono truncate">{res.snippet}</p>
                </div>
              ))
            )}
          </div>
        ) : (
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
        )}

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
      <div className="flex-1 bg-[#09090b] border border-[#27272a] rounded-xl flex flex-col overflow-hidden" ref={containerRef}>
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
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between border-b border-[#27272a] px-5 py-4 bg-[#09090b]">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-base font-extrabold text-white">{sheetData.name}</h1>
                  <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    Role: {sheetData.permission}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Spreadsheet Grid Workspace</p>
              </div>

              <div className="flex items-center gap-2">
                {/* Inline search bar */}
                <div className="relative flex items-center">
                  <input
                    type="text"
                    placeholder="Search in sheet..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-[#111] border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/50 w-40"
                  />
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5" />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="text-zinc-500 hover:text-white absolute right-2.5 text-xs font-bold font-mono"
                    >
                      ×
                    </button>
                  )}
                </div>

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
                    
                    {/* Row formatting actions */}
                    <div className="relative group">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs font-bold">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        Row Format
                      </button>
                      <div className="absolute top-full right-0 mt-1 hidden group-hover:flex flex-col bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl p-1.5 w-48 z-30 text-xs text-zinc-300">
                        <span className="px-2.5 py-1 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Row Background Color</span>
                        <div className="grid grid-cols-5 gap-1 p-1">
                          {[
                            { label: "Clear", hex: "" },
                            { label: "Red", hex: "#ef4444" },
                            { label: "Green", hex: "#10b981" },
                            { label: "Blue", hex: "#3b82f6" },
                            { label: "Yellow", hex: "#f59e0b" },
                          ].map((c) => (
                            <button
                              key={c.label}
                              onClick={() => handleUpdateSelectedRowsColor(c.hex)}
                              style={{ backgroundColor: c.hex || "#27272a" }}
                              title={c.label}
                              className="w-6 h-6 rounded-full border border-white/5 hover:scale-110 active:scale-95 transition-all"
                            />
                          ))}
                        </div>
                        <div className="border-t border-zinc-900 my-1.5" />
                        <button
                          onClick={() => {
                            const heightStr = prompt("Enter row height in px (default 34):", "34");
                            if (heightStr) {
                              const h = parseInt(heightStr);
                              if (!isNaN(h)) handleUpdateSelectedRowsHeight(h);
                            }
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded hover:bg-zinc-900 transition-all font-semibold"
                        >
                          Set Custom Height...
                        </button>
                      </div>
                    </div>

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

                {/* Pin/Frozen column view settings */}
                <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg px-2 text-xs text-zinc-400 gap-1.5">
                  <span className="font-bold text-[9px] uppercase">Freeze:</span>
                  <select
                    value={sheetData.frozenCols}
                    onChange={(e) => handleUpdateSheetSettings({ frozenCols: parseInt(e.target.value) })}
                    className="bg-[#111] border border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-300 focus:outline-none"
                  >
                    <option value={0}>0 Cols</option>
                    <option value={1}>1 Col</option>
                    <option value={2}>2 Cols</option>
                    <option value={3}>3 Cols</option>
                  </select>
                </div>

                {/* Copy with Secrets audited button */}
                <button
                  onClick={handleCopyWithSecrets}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-amber-400 transition-all text-xs font-bold"
                  title="Copy selection including plaintext passwords (audited)"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  Copy with Secrets
                </button>

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
            <div className="flex-1 w-full bg-[#040406] overflow-hidden">
              {sheetData.columns.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <Database className="w-8 h-8 text-zinc-800 mb-2" />
                  <p className="text-xs text-zinc-500 font-bold">No Columns Defined</p>
                  <p className="text-[10px] text-zinc-600 mt-1 max-w-xs leading-relaxed">
                    Click "Add Column" above to define fields such as Username (text), Passwords (secret), or Date.
                  </p>
                </div>
              ) : (
                <div className="w-full h-full relative">
                  <DataEditor
                    ref={gridRef}
                    width="100%"
                    height="100%"
                    columns={gridColumns}
                    rows={sheetData.rows.length}
                    getCellContent={getCellContent}
                    getCellsForSelection={true}
                    onCellEdited={handleCellEdited}
                    onColumnResize={handleColumnResize}
                    onColumnMoved={handleColumnMoved}
                    onCellClicked={handleCellClicked}
                    onHeaderMenuClick={handleHeaderMenuClick}
                    onPaste={handlePaste}
                    onFillPattern={handleFillPattern}
                    fillHandle={true}
                    rowMarkers="number"
                    rowHeight={getRowHeight}
                    freezeColumns={sheetData.frozenCols}
                    drawCell={handleDrawCell}
                    gridSelection={gridSelection}
                    onGridSelectionChange={setGridSelection}
                    theme={{
                      accentColor: "#3b82f6",
                      accentLight: "#3b82f61a",
                      textDark: "#d4d4d8",
                      bgCell: "#09090b",
                      bgHeader: "#18181b",
                      bgHeaderHasFocus: "#27272a",
                      bgHeaderHovered: "#27272a",
                      textHeader: "#a1a1aa",
                      borderColor: "#27272a",
                      fontFamily: "Inter, system-ui, sans-serif",
                    }}
                  />

                  {/* Absolute overlays inside coordinate context */}
                  
                  {/* Status & tags dropdown selector */}
                  {activeDropdown && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setActiveDropdown(null)} />
                      <div
                        style={{
                          position: "absolute",
                          top: activeDropdown.y + activeDropdown.height + 4,
                          left: activeDropdown.x,
                          minWidth: activeDropdown.width,
                          zIndex: 50,
                        }}
                        className="bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl p-1.5 max-h-60 overflow-y-auto flex flex-col gap-0.5 text-xs text-zinc-300"
                      >
                        {activeDropdown.options.length === 0 ? (
                          <span className="px-3 py-2 text-zinc-500 italic">No options. Open column menu to configure.</span>
                        ) : (
                          activeDropdown.options.map((opt) => {
                            const isSelected = activeDropdown.isTags
                              ? activeDropdown.value.split(",").map((s) => s.trim()).includes(opt.id)
                              : activeDropdown.value === opt.id || activeDropdown.value === opt.label;
                            
                            return (
                              <button
                                key={opt.id}
                                onClick={() => {
                                  let newVal = "";
                                  if (activeDropdown.isTags) {
                                    const currentTags = activeDropdown.value.split(",").map((s) => s.trim()).filter(Boolean);
                                    if (currentTags.includes(opt.id)) {
                                      newVal = currentTags.filter((t) => t !== opt.id).join(",");
                                    } else {
                                      newVal = [...currentTags, opt.id].join(",");
                                    }
                                  } else {
                                    newVal = opt.id;
                                  }

                                  handleUpdateCellOptimistic(activeDropdown.rowId, activeDropdown.columnId, newVal);
                                  if (activeDropdown.isTags) {
                                    setActiveDropdown((prev) => prev ? { ...prev, value: newVal } : null);
                                  } else {
                                    setActiveDropdown(null);
                                  }
                                }}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-900 transition-all font-semibold ${
                                  isSelected ? "text-white bg-zinc-900/60" : "text-zinc-400"
                                }`}
                              >
                                <span
                                  style={{ backgroundColor: opt.color + "22", color: opt.color, borderColor: opt.color + "44" }}
                                  className="px-2 py-0.5 rounded border text-[10px] font-bold"
                                >
                                  {opt.label}
                                </span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-blue-500" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}

                  {/* Header menu context dropdown */}
                  {headerMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setHeaderMenu(null)} />
                      <div
                        style={{
                          position: "absolute",
                          top: headerMenu.bounds.y + headerMenu.bounds.height + 4,
                          left: Math.min(
                            headerMenu.bounds.x,
                            (containerRef.current?.clientWidth || 0) - 160
                          ),
                          zIndex: 50,
                        }}
                        className="bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl p-1 w-40 flex flex-col text-xs"
                      >
                        <button
                          onClick={() => {
                            const columnsList = sheetData?.columns.filter((c) => !c.hidden);
                            const col = columnsList?.[headerMenu.colIdx];
                            if (col) {
                              const newName = prompt("Enter new column name:", col.name);
                              if (newName && newName.trim()) {
                                handleRenameColumn(col.id, newName.trim());
                              }
                            }
                            setHeaderMenu(null);
                          }}
                          className="px-3 py-2 text-left hover:bg-zinc-900 rounded-lg text-zinc-300 hover:text-white font-medium"
                        >
                          Rename Column
                        </button>
                        <button
                          onClick={() => {
                            const columnsList = sheetData?.columns.filter((c) => !c.hidden);
                            const col = columnsList?.[headerMenu.colIdx];
                            if (col) {
                              handleDeleteColumn(col.id);
                            }
                            setHeaderMenu(null);
                          }}
                          className="px-3 py-2 text-left hover:bg-red-950/30 hover:text-red-400 rounded-lg text-zinc-400 font-medium"
                        >
                          Delete Column
                        </button>
                        <button
                          onClick={() => {
                            const columnsList = sheetData?.columns.filter((c) => !c.hidden);
                            const col = columnsList?.[headerMenu.colIdx];
                            if (col) {
                              handleTogglePinColumn(col.id, !col.pinned);
                            }
                            setHeaderMenu(null);
                          }}
                          className="px-3 py-2 text-left hover:bg-zinc-900 rounded-lg text-zinc-300 hover:text-white font-medium"
                        >
                          {sheetData?.columns.filter((c) => !c.hidden)[headerMenu.colIdx]?.pinned ? "Unpin Column" : "Pin Column"}
                        </button>
                        <button
                          onClick={() => {
                            const columnsList = sheetData?.columns.filter((c) => !c.hidden);
                            const col = columnsList?.[headerMenu.colIdx];
                            if (col) {
                              handleToggleHideColumn(col.id, true);
                            }
                            setHeaderMenu(null);
                          }}
                          className="px-3 py-2 text-left hover:bg-zinc-900 rounded-lg text-zinc-300 hover:text-white font-medium"
                        >
                          Hide Column
                        </button>
                        {(sheetData?.columns.filter((c) => !c.hidden)[headerMenu.colIdx]?.type === "status" ||
                          sheetData?.columns.filter((c) => !c.hidden)[headerMenu.colIdx]?.type === "tags") && (
                          <button
                            onClick={() => {
                              const columnsList = sheetData?.columns.filter((c) => !c.hidden);
                              const col = columnsList?.[headerMenu.colIdx];
                              if (col) {
                                openConfigModal(col.id);
                              }
                              setHeaderMenu(null);
                            }}
                            className="px-3 py-2 text-left hover:bg-zinc-900 rounded-lg text-zinc-300 hover:text-white font-medium border-t border-zinc-900 mt-1"
                          >
                            Configure Options
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
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
                  <option value="status">Status Dropdown</option>
                  <option value="tags">Tags (Multi-select)</option>
                  <option value="account_link">Linked Managed Account</option>
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
                    <p className="text-xs text-zinc-500 italic">No one else has access to this folder yet</p>
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
                          className="flex items-center justify-between bg-zinc-950 border border-zinc-850 p-2 py-1.5 rounded-lg gap-4"
                        >
                          <div className="text-xs truncate max-w-[50%]">
                            <p className="font-semibold text-white truncate">{desc}</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <select
                              value={access.permission}
                              onChange={(e) => handleUpdateExistingAccess(access, e.target.value)}
                              className="bg-[#111] border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                            >
                              <option value="view">View</option>
                              <option value="edit">Edit</option>
                              <option value="manage">Manage</option>
                            </select>
                            
                            <button
                              onClick={() => handleRevokeShare(access.id)}
                              className="p-1 text-zinc-500 hover:text-red-400 hover:bg-[#111] rounded transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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

              {/* Folder Owner (KPI Attribution) */}
              <div className="border-t border-[#27272a] pt-4 space-y-2">
                <label className="block text-[10px] uppercase font-bold text-zinc-500">Folder Owner (KPI Attribution)</label>
                <div className="flex gap-2">
                  <select
                    value={folders.find((f: any) => f.id === shareModalFolderId)?.ownerUserId || ""}
                    onChange={(e) => handleSetFolderOwner(shareModalFolderId!, e.target.value || null)}
                    className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2.5 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="">-- No Owner (Unassigned) --</option>
                    {usersList.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name || "Unknown"} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
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
                                    <option value="status">Status Dropdown</option>
                                    <option value="tags">Tags (Multi-select)</option>
                                    <option value="account_link">Linked Managed Account</option>
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

      {/* 7. Column options config modal */}

      {/* Helper function and modals for Linked Managed Accounts */}
      {(() => {
        const handleLinkAccount = async (rowId: string, columnId: string, accountId: string | null) => {
          if (!selectedSheetId || !sheetData) return;

          const prevRows = JSON.parse(JSON.stringify(sheetData.rows));
          setSheetData((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              rows: prev.rows.map((r: any) => {
                if (r.id !== rowId) return r;
                
                let cellExists = false;
                const updatedCells = r.cells.map((c: any) => {
                  if (c.columnId !== columnId) return c;
                  cellExists = true;
                  return {
                    ...c,
                    value: accountId ? `@${allManagedAccounts.find(a => a.id === accountId)?.tiktokUsername || ""}` : "",
                    hasValue: !!accountId,
                    managedAccountId: accountId,
                  };
                });

                if (!cellExists) {
                  updatedCells.push({
                    id: `temp-${rowId}-${columnId}`,
                    rowId,
                    columnId,
                    value: accountId ? `@${allManagedAccounts.find(a => a.id === accountId)?.tiktokUsername || ""}` : "",
                    hasValue: !!accountId,
                    managedAccountId: accountId,
                  });
                }

                return { ...r, cells: updatedCells };
              }),
            };
          });

          try {
            const res = await fetch(`/api/managed/vault/sheets/${selectedSheetId}/cells`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rowId,
                columnId,
                value: accountId ? `@${allManagedAccounts.find(a => a.id === accountId)?.tiktokUsername || ""}` : "",
                managedAccountId: accountId,
              }),
            });
            if (!res.ok) throw new Error("Failed to link account");
            toast.success(accountId ? "Account linked successfully" : "Account unlinked successfully");
            fetchSheet(selectedSheetId);
          } catch (err: any) {
            toast.error(err.message || "Failed to update account link");
            setSheetData((prev: any) => {
              if (!prev) return prev;
              return { ...prev, rows: prevRows };
            });
          } finally {
            setActiveAccountPicker(null);
          }
        };

        return (
          <>
            {/* Account Link Picker Modal */}
            {activeAccountPicker && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
                <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
                  <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <UserPlus className="w-4 h-4 text-purple-400" />
                      Link Managed Account
                    </h3>
                    <button
                      onClick={() => setActiveAccountPicker(null)}
                      className="text-zinc-500 hover:text-white transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-4 border-b border-[#27272a] bg-[#11111c]/30">
                    <input
                      type="text"
                      placeholder="Search accounts by username, display name..."
                      value={accountPickerSearch}
                      onChange={(e) => setAccountPickerSearch(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-purple-500/50"
                      autoFocus
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {loadingAccounts ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                      </div>
                    ) : allManagedAccounts.filter(a =>
                      a.tiktokUsername.toLowerCase().includes(accountPickerSearch.toLowerCase()) ||
                      a.tiktokDisplayName.toLowerCase().includes(accountPickerSearch.toLowerCase())
                    ).length === 0 ? (
                      <p className="text-zinc-500 text-xs italic text-center py-4">No matching accounts found.</p>
                    ) : (
                      allManagedAccounts.filter(a =>
                        a.tiktokUsername.toLowerCase().includes(accountPickerSearch.toLowerCase()) ||
                        a.tiktokDisplayName.toLowerCase().includes(accountPickerSearch.toLowerCase())
                      ).map(acc => (
                        <div key={acc.id} className="flex items-center justify-between p-2 rounded-xl bg-zinc-950 border border-zinc-900 hover:border-zinc-800 transition-all">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {acc.tiktokAvatarUrl ? (
                              <img src={acc.tiktokAvatarUrl} alt="" className="w-8 h-8 rounded-full bg-zinc-800 flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-purple-400 flex-shrink-0">
                                @
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-white truncate">@{acc.tiktokUsername}</p>
                              <p className="text-[10px] text-zinc-500 truncate">{acc.tiktokDisplayName || "TikTok Creator"}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleLinkAccount(activeAccountPicker.rowId, activeAccountPicker.columnId, acc.id)}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition-all"
                          >
                            Link
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Account Settings Popup Editor Modal */}
            {activeAccountPopup && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
                <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                  <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between bg-zinc-950/30">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
                      <h3 className="text-sm font-bold text-white">
                        Account Settings & Schedule
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {sheetData?.permission !== "view" && (
                        <button
                          onClick={() => {
                            if (confirm("Are you sure you want to unlink this managed account from this cell?")) {
                              handleLinkAccount(activeAccountPopup.rowId, activeAccountPopup.columnId, null);
                              setActiveAccountPopup(null);
                            }
                          }}
                          className="px-2.5 py-1 bg-red-950 border border-red-900/50 hover:bg-red-900/30 text-red-300 text-[10px] font-bold rounded-lg transition-all"
                          title="Remove this account reference from the cell without deleting the account itself"
                        >
                          Unlink Account
                        </button>
                      )}
                      <button
                        onClick={() => setActiveAccountPopup(null)}
                        className="text-zinc-500 hover:text-white transition-all ml-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="p-5 overflow-y-auto">
                    <ManagedAccountEditForm
                      accountId={activeAccountPopup.accountId}
                      isReadOnly={sheetData?.permission === "view" || !hasAccountsEditAccess}
                      onClose={() => setActiveAccountPopup(null)}
                      onSave={() => fetchSheet(selectedSheetId!)}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}
      
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-500" />
                Configure Column Options
              </h3>
              <button
                onClick={() => setShowConfigModal(null)}
                className="text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-2">
                {configOptions.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-2 bg-zinc-950 p-2 rounded-lg border border-zinc-850">
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => {
                        const updated = [...configOptions];
                        updated[idx].label = e.target.value;
                        setConfigOptions(updated);
                      }}
                      placeholder="Option label"
                      className="flex-1 bg-[#111] border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    />
                    <select
                      value={opt.color}
                      onChange={(e) => {
                        const updated = [...configOptions];
                        updated[idx].color = e.target.value;
                        setConfigOptions(updated);
                      }}
                      className="bg-[#111] border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                    >
                      <option value="#ef4444">Red</option>
                      <option value="#f97316">Orange</option>
                      <option value="#f59e0b">Yellow</option>
                      <option value="#10b981">Green</option>
                      <option value="#14b8a6">Teal</option>
                      <option value="#3b82f6">Blue</option>
                      <option value="#6366f1">Indigo</option>
                      <option value="#8b5cf6">Purple</option>
                      <option value="#ec4899">Pink</option>
                      <option value="#71717a">Gray</option>
                    </select>
                    <button
                      onClick={() => {
                        setConfigOptions(configOptions.filter((o) => o.id !== opt.id));
                      }}
                      className="p-1 hover:text-red-400 transition-all text-zinc-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  setConfigOptions([
                    ...configOptions,
                    { id: `opt-${Date.now()}`, label: `Option ${configOptions.length + 1}`, color: "#3b82f6" },
                  ]);
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg text-xs font-bold text-zinc-400 hover:text-white transition-all bg-zinc-950/20"
              >
                <Plus className="w-3.5 h-3.5 text-blue-500" />
                Add New Option
              </button>

              {/* Zoned Outcomes KPI Tracking */}
              <div className="border-t border-zinc-900/60 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">Track KPI Outcomes</label>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trackEnabled}
                      onChange={(e) => setTrackEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-350 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-650"></div>
                  </label>
                </div>

                {trackEnabled && (
                  <div className="space-y-3 bg-zinc-950 p-3 rounded-xl border border-zinc-900 animate-fadeIn">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1.5">Success Outcomes</label>
                      <div className="flex flex-wrap gap-1.5">
                        {configOptions.length === 0 ? (
                          <p className="text-[10px] text-zinc-650 italic">Add options above first.</p>
                        ) : (
                          configOptions.map((opt) => {
                            const isChecked = successOptionIds.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                onClick={() => {
                                  if (isChecked) {
                                    setSuccessOptionIds(successOptionIds.filter((id) => id !== opt.id));
                                  } else {
                                    setSuccessOptionIds([...successOptionIds, opt.id]);
                                    setFailOptionIds(failOptionIds.filter((id) => id !== opt.id));
                                  }
                                }}
                                className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${
                                  isChecked
                                    ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-400"
                                    : "bg-zinc-900/40 border-zinc-800 text-zinc-450 hover:border-zinc-700"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1.5">Fail Outcomes</label>
                      <div className="flex flex-wrap gap-1.5">
                        {configOptions.length === 0 ? (
                          <p className="text-[10px] text-zinc-650 italic">Add options above first.</p>
                        ) : (
                          configOptions.map((opt) => {
                            const isChecked = failOptionIds.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                onClick={() => {
                                  if (isChecked) {
                                    setFailOptionIds(failOptionIds.filter((id) => id !== opt.id));
                                  } else {
                                    setFailOptionIds([...failOptionIds, opt.id]);
                                    setSuccessOptionIds(successOptionIds.filter((id) => id !== opt.id));
                                  }
                                }}
                                className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${
                                  isChecked
                                    ? "bg-red-950/40 border-red-500/50 text-red-400"
                                    : "bg-zinc-900/40 border-zinc-800 text-zinc-450 hover:border-zinc-700"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => handleSaveColumnConfig(showConfigModal, configOptions)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all mt-4"
              >
                Save Option List
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
