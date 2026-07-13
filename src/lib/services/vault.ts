import prisma from "@/lib/db";
import crypto from "crypto";
import { can } from "./permissions";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

// Resolve the encryption key dynamically with fallback warning for developer environments
const ENCRYPTION_KEY_ENV = process.env.VAULT_ENCRYPTION_KEY || process.env.SESSION_SECRET || "default-vault-secret-key-32chars!";
if (!process.env.VAULT_ENCRYPTION_KEY) {
  console.warn("[Vault Service] WARNING: VAULT_ENCRYPTION_KEY environment variable is not defined. Falling back to SESSION_SECRET / default key.");
}

// Helper: derive 32-byte key
function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY_ENV).digest();
}

/**
 * Reversible AES-256-GCM encryption helper.
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  // Format: iv:authTag:ciphertext
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Reversible AES-256-GCM decryption helper.
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }
  
  const [ivHex, authTagHex, encryptedTextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedTextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

/**
 * Audit Logger Helper.
 */
export async function logVaultAction(userId: string | null, action: string, target: string) {
  let userEmail: string | null = null;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    userEmail = user?.email || null;
  }
  
  return await prisma.vaultAuditLog.create({
    data: {
      userId,
      userEmail,
      action,
      target,
    },
  });
}

/**
 * Calculate effective folder access level recursively.
 * Subfolders inherit access rules unless an explicit override exists on the folder.
 * Admin role key "admin" gets automatic "manage" access on all folders.
 */
export async function getFolderPermission(
  userId: string,
  folderId: string
): Promise<"view" | "edit" | "manage" | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  if (!user || user.status === "DISABLED") return null;

  // 1. Administrators automatically have absolute manage permission
  if (user.role?.key === "admin") {
    return "manage";
  }

  // 2. Gate accessibility on base projects tool entitlement
  const hasProjectsEntitlement = await can(userId, "data_vault");
  if (!hasProjectsEntitlement) return null;

  // 3. Traversal up the parent hierarchy to locate nearest ACL configuration
  let currentId: string | null = folderId;
  while (currentId) {
    const folderNode: any = await prisma.vaultFolder.findUnique({
      where: { id: currentId },
      include: { accessList: true },
    });
    if (!folderNode) break;

    // Check if the current folder node has explicit permission entries
    if (folderNode.accessList.length > 0) {
      let highest: "view" | "edit" | "manage" | null = null;
      
      for (const entry of folderNode.accessList) {
        if (entry.userId === userId) {
          highest = getHigherPermission(highest, entry.permission as any);
        } else if (entry.roleKey === user.role?.key) {
          highest = getHigherPermission(highest, entry.permission as any);
        }
      }
      
      return highest; // Nearest ACL configuration governs this path, terminate check
    }

    currentId = folderNode.parentFolderId;
  }

  // 4. Default baseline permission for folders without any restricted access settings
  // If the directory has no custom configurations set up, all projects users default to edit
  return "edit";
}

function getHigherPermission(
  a: "view" | "edit" | "manage" | null,
  b: "view" | "edit" | "manage"
): "view" | "edit" | "manage" {
  if (!a) return b;
  const weights = { view: 1, edit: 2, manage: 3 };
  return weights[a] >= weights[b] ? a : b;
}

// ── FOLDER CRUD SERVICES ─────────────────────────────────────────────────────

export async function createFolder(userId: string, name: string, parentFolderId?: string | null) {
  if (parentFolderId) {
    const parentPermission = await getFolderPermission(userId, parentFolderId);
    if (!parentPermission || parentPermission === "view") {
      throw new Error("Forbidden: You do not have permissions to write under this folder");
    }
  } else {
    // Creating root folders is restricted to active project management users
    const hasProjects = await can(userId, "data_vault");
    if (!hasProjects) throw new Error("Forbidden: data_vault entitlement required");
  }

  const folder = await prisma.vaultFolder.create({
    data: {
      name: name.trim(),
      parentFolderId: parentFolderId || null,
      createdBy: userId,
    },
  });

  await logVaultAction(userId, "create_folder", `Folder: "${folder.name}" (${folder.id})`);
  return folder;
}

export async function renameFolder(userId: string, folderId: string, newName: string) {
  const perm = await getFolderPermission(userId, folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required to modify folders");
  }

  const folder = await prisma.vaultFolder.update({
    where: { id: folderId },
    data: { name: newName.trim() },
  });

  await logVaultAction(userId, "rename_folder", `Folder: "${folder.name}" (${folder.id})`);
  return folder;
}

export async function moveFolder(userId: string, folderId: string, targetParentId: string | null) {
  const sourcePerm = await getFolderPermission(userId, folderId);
  if (!sourcePerm || sourcePerm === "view") {
    throw new Error("Forbidden: edit/manage access required to move folders");
  }

  if (targetParentId) {
    const targetPerm = await getFolderPermission(userId, targetParentId);
    if (!targetPerm || targetPerm === "view") {
      throw new Error("Forbidden: edit/manage access required on destination parent");
    }
  }

  const folder = await prisma.vaultFolder.update({
    where: { id: folderId },
    data: { parentFolderId: targetParentId },
  });

  await logVaultAction(userId, "move_folder", `Folder: "${folder.name}" moved to parent ${targetParentId || "root"}`);
  return folder;
}

export async function deleteFolder(userId: string, folderId: string) {
  const perm = await getFolderPermission(userId, folderId);
  if (perm !== "manage") {
    throw new Error("Forbidden: manage access required to delete folders");
  }

  const folder = await prisma.vaultFolder.findUnique({ where: { id: folderId } });
  if (!folder) throw new Error("Folder not found");

  await prisma.vaultFolder.delete({
    where: { id: folderId },
  });

  await logVaultAction(userId, "delete_folder", `Folder: "${folder.name}" (${folder.id})`);
  return folder;
}

export async function listAccessibleFolders(userId: string) {
  const folders = await prisma.vaultFolder.findMany({
    include: {
      sheets: {
        select: { id: true, name: true, createdAt: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const accessible: any[] = [];
  for (const f of folders) {
    const perm = await getFolderPermission(userId, f.id);
    if (perm !== null) {
      accessible.push({
        ...f,
        permission: perm,
      });
    }
  }
  return accessible;
}

// ── ACCESS CONTROL LIST SERVICES ─────────────────────────────────────────────

export async function grantFolderAccess(
  userId: string,
  folderId: string,
  targetUserOrRole: { targetUserId?: string; roleKey?: string },
  permission: "view" | "edit" | "manage"
) {
  const caller = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  const isAuthorized =
    caller?.role?.key === "admin" ||
    caller?.role?.key === "team_lead" ||
    (await getFolderPermission(userId, folderId)) === "manage";

  if (!isAuthorized) {
    throw new Error("Forbidden: Access management privileges required");
  }

  const { targetUserId, roleKey } = targetUserOrRole;
  if (!targetUserId && !roleKey) {
    throw new Error("Invalid target: Must specify a targetUserId or roleKey");
  }

  const access = await prisma.vaultFolderAccess.upsert({
    where: targetUserId
      ? { folderId_userId: { folderId, userId: targetUserId } }
      : { folderId_roleKey: { folderId, roleKey: roleKey! } },
    update: { permission },
    create: {
      folderId,
      userId: targetUserId || null,
      roleKey: roleKey || null,
      permission,
    },
  });

  const targetDesc = targetUserId ? `User ID ${targetUserId}` : `Role Key "${roleKey}"`;
  await logVaultAction(userId, "grant", `Folder ${folderId} shared with ${targetDesc} with permission: ${permission}`);
  return access;
}

export async function revokeFolderAccess(userId: string, folderId: string, accessId: string) {
  const caller = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  const isAuthorized =
    caller?.role?.key === "admin" ||
    caller?.role?.key === "team_lead" ||
    (await getFolderPermission(userId, folderId)) === "manage";

  if (!isAuthorized) {
    throw new Error("Forbidden: Access management privileges required");
  }

  const access = await prisma.vaultFolderAccess.findUnique({ where: { id: accessId } });
  if (!access || access.folderId !== folderId) {
    throw new Error("Access entry not found on this folder");
  }

  await prisma.vaultFolderAccess.delete({
    where: { id: accessId },
  });

  const targetDesc = access.userId ? `User ID ${access.userId}` : `Role Key "${access.roleKey}"`;
  await logVaultAction(userId, "revoke", `Revoked access of ${targetDesc} to Folder ${folderId}`);
  return true;
}

// ── SHEET & COLUMN CRUD SERVICES ─────────────────────────────────────────────

export async function createSheet(userId: string, folderId: string, name: string) {
  const perm = await getFolderPermission(userId, folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required to write inside this folder");
  }

  const sheet = await prisma.sheet.create({
    data: {
      folderId,
      name: name.trim(),
    },
  });

  await logVaultAction(userId, "create_sheet", `Sheet: "${sheet.name}" under Folder ID ${folderId}`);
  return sheet;
}

export async function addColumn(userId: string, sheetId: string, name: string, type: string) {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required");
  }

  // Find current maximum order for placement
  const maxOrder = await prisma.sheetColumn.aggregate({
    where: { sheetId },
    _max: { order: true },
  });
  const nextOrder = (maxOrder._max.order ?? -1) + 1;

  const column = await prisma.sheetColumn.create({
    data: {
      sheetId,
      name: name.trim(),
      type,
      order: nextOrder,
    },
  });

  await logVaultAction(userId, "add_column", `Column: "${column.name}" (${column.type}) added to Sheet ${sheetId}`);
  return column;
}

export async function deleteColumn(userId: string, sheetId: string, columnId: string) {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required");
  }

  const col = await prisma.sheetColumn.findUnique({ where: { id: columnId } });
  if (!col) throw new Error("Column not found");

  await prisma.sheetColumn.delete({
    where: { id: columnId },
  });

  await logVaultAction(userId, "delete_column", `Column: "${col.name}" deleted from Sheet ${sheetId}`);
  return col;
}

// ── ROW & CELL CRUD SERVICES ─────────────────────────────────────────────────

export async function addRow(userId: string, sheetId: string) {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required");
  }

  // Find max row order to append at the end
  const maxOrder = await prisma.sheetRow.aggregate({
    where: { sheetId },
    _max: { order: true },
  });
  const nextOrder = (maxOrder._max.order ?? -1) + 1;

  const row = await prisma.sheetRow.create({
    data: {
      sheetId,
      order: nextOrder,
    },
  });

  await logVaultAction(userId, "add_row", `Row: Added row ${row.id} to Sheet ${sheetId}`);
  return row;
}

export async function deleteRow(userId: string, sheetId: string, rowId: string) {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required");
  }

  await prisma.sheetRow.delete({
    where: { id: rowId },
  });

  await logVaultAction(userId, "delete_row", `Row: Deleted row ${rowId} from Sheet ${sheetId}`);
  return true;
}

export async function updateCell(
  userId: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  value: string | null,
  managedAccountId?: string | null
) {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required");
  }

  const column = await prisma.sheetColumn.findUnique({ where: { id: columnId } });
  if (!column || column.sheetId !== sheetId) {
    throw new Error("Invalid column identification");
  }

  let finalValue: string | null = null;
  let finalValueEncrypted: string | null = null;

  if (value !== null && value !== "") {
    if (column.type === "secret") {
      finalValueEncrypted = encrypt(value);
      await logVaultAction(userId, "edit_secret", `Cell: Modified secret value in row ${rowId}, column "${column.name}"`);
    } else {
      finalValue = value;
    }
  }

  const isAccountLink = column.type === "account_link";

  const cell = await prisma.sheetCell.upsert({
    where: {
      rowId_columnId: { rowId, columnId },
    },
    update: {
      value: finalValue,
      valueEncrypted: finalValueEncrypted,
      managedAccountId: isAccountLink ? (managedAccountId || null) : null,
    },
    create: {
      rowId,
      columnId,
      value: finalValue,
      valueEncrypted: finalValueEncrypted,
      managedAccountId: isAccountLink ? (managedAccountId || null) : null,
    },
  });

  return cell;
}

/**
 * Decrypts a single cell of type secret and audits the reveal action.
 */
export async function revealCell(userId: string, sheetId: string, cellId: string): Promise<string> {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm) {
    throw new Error("Forbidden: You have no view access to this sheet");
  }

  const cell = await prisma.sheetCell.findUnique({
    where: { id: cellId },
    include: { column: true },
  });
  if (!cell || cell.column.sheetId !== sheetId) {
    throw new Error("Cell not found");
  }

  if (cell.column.type !== "secret" || !cell.valueEncrypted) {
    return cell.value || "";
  }

  const decrypted = decrypt(cell.valueEncrypted);
  await logVaultAction(userId, "reveal", `Cell: Revealed secret in row ${cell.rowId}, column "${cell.column.name}"`);
  return decrypted;
}

// ── CSV IMPORT & EXPORT UTILITIES ─────────────────────────────────────────────

/**
 * Export Sheet to CSV structure.
 * Audits export, optionally decodes secrets for authorized managers.
 */
export async function exportCsv(
  userId: string,
  sheetId: string,
  options: { includeSecrets?: boolean }
): Promise<string> {
  const sheet = await prisma.sheet.findUnique({
    where: { id: sheetId },
    include: {
      columns: { orderBy: { order: "asc" } },
      rows: {
        orderBy: { order: "asc" },
        include: { cells: true },
      },
    },
  });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm) throw new Error("Forbidden: Access required");

  const includeSecrets = !!options.includeSecrets;
  if (includeSecrets && perm !== "manage") {
    throw new Error("Forbidden: Only folder managers can export secrets");
  }

  // Build headers
  const csvHeaders = sheet.columns.map((c) => c.name);
  const rows: string[][] = [csvHeaders];

  for (const r of sheet.rows) {
    const rowValues = sheet.columns.map((c) => {
      const cell = r.cells.find((cell) => cell.columnId === c.id);
      if (!cell) return "";
      
      if (c.type === "secret") {
        if (includeSecrets && cell.valueEncrypted) {
          try {
            return decrypt(cell.valueEncrypted);
          } catch {
            return "[Error Decrypting]";
          }
        }
        return "••••••";
      }
      
      return cell.value || "";
    });
    rows.push(rowValues);
  }

  // Convert array to CSV string conforming to CSV syntax rules (escaped quotes, commas)
  const csvContent = rows
    .map((row) =>
      row
        .map((val) => {
          const escaped = val.replace(/"/g, '""');
          if (escaped.includes(",") || escaped.includes("\n") || escaped.includes('"')) {
            return `"${escaped}"`;
          }
          return escaped;
        })
        .join(",")
    )
    .join("\n");

  await logVaultAction(
    userId,
    "export",
    `Sheet: Exported CSV from "${sheet.name}" (Secrets included: ${includeSecrets})`
  );
  return csvContent;
}

/**
 * Import CSV values into an existing sheet with columns mapper.
 * Column mapper maps CSV headers to existing column IDs (or requests new ones).
 */
export async function importCsv(
  userId: string,
  sheetId: string,
  csvData: string,
  columnMapping: Array<{ csvHeader: string; columnId?: string; newName?: string; newType?: string }>,
  mode: "append" | "replace"
) {
  const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
  if (!sheet) throw new Error("Sheet not found");

  const perm = await getFolderPermission(userId, sheet.folderId);
  if (!perm || perm === "view") {
    throw new Error("Forbidden: edit/manage access required to import");
  }

  // Parse CSV Rows (handles commas inside quotes, line endings, escaped characters)
  const rowsParsed = parseCsv(csvData);
  if (rowsParsed.length === 0) {
    throw new Error("Empty CSV file uploaded");
  }

  const headers = rowsParsed[0];
  const dataRows = rowsParsed.slice(1);

  // If replacing, purge existing rows and cells
  if (mode === "replace") {
    await prisma.sheetRow.deleteMany({ where: { sheetId } });
  }

  // 1. Process column configurations first (create any requested new columns)
  const columnResolveMap: Record<string, { id: string; type: string }> = {};

  for (const map of columnMapping) {
    const csvColIdx = headers.findIndex((h) => h.trim() === map.csvHeader.trim());
    if (csvColIdx === -1) continue;

    if (map.columnId) {
      const existingCol = await prisma.sheetColumn.findUnique({ where: { id: map.columnId } });
      if (existingCol) {
        columnResolveMap[map.csvHeader] = { id: existingCol.id, type: existingCol.type };
      }
    } else if (map.newName && map.newType) {
      // Create new column dynamically
      const maxOrder = await prisma.sheetColumn.aggregate({
        where: { sheetId },
        _max: { order: true },
      });
      const nextOrder = (maxOrder._max.order ?? -1) + 1;

      const newCol = await prisma.sheetColumn.create({
        data: {
          sheetId,
          name: map.newName.trim(),
          type: map.newType,
          order: nextOrder,
        },
      });
      columnResolveMap[map.csvHeader] = { id: newCol.id, type: newCol.type };
    }
  }

  // Get current max order of rows in the sheet
  const maxRowOrder = await prisma.sheetRow.aggregate({
    where: { sheetId },
    _max: { order: true },
  });
  let rowOrderOffset = (maxRowOrder._max.order ?? -1) + 1;

  // 2. Insert rows and cell values
  for (let i = 0; i < dataRows.length; i++) {
    const rowData = dataRows[i];
    const createdRow = await prisma.sheetRow.create({
      data: {
        sheetId,
        order: rowOrderOffset++,
      },
    });

    for (const [headerName, colConfig] of Object.entries(columnResolveMap)) {
      const csvColIdx = headers.findIndex((h) => h.trim() === headerName.trim());
      if (csvColIdx === -1) continue;

      const cellRawValue = rowData[csvColIdx];
      if (cellRawValue === undefined || cellRawValue === null) continue;

      const trimmedVal = cellRawValue.trim();
      let value: string | null = null;
      let valueEncrypted: string | null = null;

      if (trimmedVal !== "") {
        if (colConfig.type === "secret") {
          valueEncrypted = encrypt(trimmedVal);
        } else {
          value = trimmedVal;
        }
      }

      await prisma.sheetCell.create({
        data: {
          rowId: createdRow.id,
          columnId: colConfig.id,
          value,
          valueEncrypted,
        },
      });
    }
  }

  await logVaultAction(
    userId,
    "import",
    `Sheet: Imported CSV into "${sheet.name}" with ${dataRows.length} rows (${mode} mode)`
  );
  return { success: true, count: dataRows.length };
}

/**
 * Standard CSV line parser conforming to RFC 4180 specs.
 * Accounts for quoted cells, double quotes, and line breaks within quotes.
 */
function parseCsv(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let curr = "";
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    
    if (c === '"') {
      if (inQuotes && next === '"') {
        // Escaped quote character (e.g. "")
        curr += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      row.push(curr);
      curr = "";
    } else if ((c === "\r" || c === "\n") && !inQuotes) {
      if (c === "\r" && next === "\n") {
        i++;
      }
      row.push(curr);
      result.push(row);
      row = [];
      curr = "";
    } else {
      curr += c;
    }
  }
  
  if (row.length > 0 || curr !== "") {
    row.push(curr);
    result.push(row);
  }
  
  return result.filter(r => r.length > 0 && r.some(cell => cell.trim() !== ""));
}

/**
 * Fetch computed folder access configuration for a specific user.
 * Walks hierarchies to return explicit and inherited permissions for all vault folders.
 */
export async function getUserVaultAccess(targetUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { role: true },
  });
  if (!user) throw new Error("User not found");

  const folders = await prisma.vaultFolder.findMany({
    include: {
      accessList: true,
    },
    orderBy: { name: "asc" },
  });

  const hasProjects = await can(targetUserId, "data_vault");

  const results = [];

  for (const folder of folders) {
    let permission: "view" | "edit" | "manage" | null = null;
    let isInherited = false;
    let isExplicit = false;
    let inheritedFromFolderId: string | undefined = undefined;
    let inheritedFromName: string | undefined = undefined;
    let accessId: string | undefined = undefined;

    if (user.status === "DISABLED") {
      permission = null;
    } else if (user.role?.key === "admin") {
      permission = "manage";
      isExplicit = true;
    } else if (!hasProjects) {
      permission = null;
    } else {
      // Walk parent chain
      let currentId: string | null = folder.id;
      let nearestConfiguredFolder: any = null;

      while (currentId) {
        const node = folders.find((f) => f.id === currentId);
        if (!node) break;

        if (node.accessList.length > 0) {
          nearestConfiguredFolder = node;
          break; // Stop walk at nearest configured directory level
        }
        currentId = node.parentFolderId;
      }

      if (!nearestConfiguredFolder) {
        // Default baseline projects access
        permission = "edit";
        isExplicit = false;
        isInherited = false;
      } else {
        // Look for matching rules
        let highest: "view" | "edit" | "manage" | null = null;
        let matchedAccess: any = null;

        for (const entry of nearestConfiguredFolder.accessList) {
          if (entry.userId === targetUserId) {
            highest = getHigherPermission(highest, entry.permission as any);
            matchedAccess = entry;
          } else if (entry.roleKey === user.role?.key) {
            highest = getHigherPermission(highest, entry.permission as any);
            matchedAccess = entry;
          }
        }

        if (highest) {
          permission = highest;
          if (nearestConfiguredFolder.id === folder.id) {
            isExplicit = true;
            isInherited = false;
            if (matchedAccess?.userId === targetUserId) {
              accessId = matchedAccess.id; // User-specific accessId for quick revocation
            }
          } else {
            isExplicit = false;
            isInherited = true;
            inheritedFromFolderId = nearestConfiguredFolder.id;
            inheritedFromName = nearestConfiguredFolder.name;
          }
        } else {
          // Nearest configured folder has permissions but none match this user
          permission = null;
          isExplicit = false;
          isInherited = false;
        }
      }
    }

    results.push({
      folderId: folder.id,
      folderName: folder.name,
      parentFolderId: folder.parentFolderId,
      permission,
      isInherited,
      isExplicit,
      inheritedFromFolderId,
      inheritedFromName,
      accessId,
    });
  }

  return results;
}

