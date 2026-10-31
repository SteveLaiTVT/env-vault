"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseBackup, migrationCounts, type BackupFile, type BackupVariable } from "../lib/backup";
import { api, ApiError } from "../lib/client-api";
import {
  aesDecrypt,
  buildTokenString,
  deriveKeys,
  exportDekRaw,
  generateDek,
  generateRsaWrapPair,
  newAuthSecret,
  newKdfSalt,
  rsaWrapDek,
  unwrapDek,
  wrapDek,
} from "../lib/crypto";
import { parseDotenv } from "../lib/dotenv";
import { parseImportFile, summarizeImport } from "../lib/import-files";
import { planTransfer, type ConflictPolicy, type TransferMode } from "../lib/transfer";
import { BUILTIN_LIST, builtinTemplate, fileNameFor, fillTemplate, renderFormat, type BuiltinId } from "../lib/format";
import { FORMAT_LABEL } from "../lib/labels";
import { loadSnapshot, saveSnapshot, trimAudits } from "../lib/local-db";
import { activeEntries, mergeEffective, scopeRankLabel } from "../lib/merge";
import type { VarRef } from "../lib/types";
import { emptySnapshot, type AuditItem, type DecryptedVar, type LinkRecord, type LocalSnapshot, type ProjectRecord, type ServerRecord, type StoredTemplate, type StoredVar, type StoredVersion, type VaultMeta } from "../lib/model";
import { canaryMatches, openStored, sealCanary, sealStored } from "../lib/record-crypto";
import { KEY_RE, MAX_NOTE_CHARS, MAX_VALUE_BYTES, PROD_KDF, VERSION_KEEP, type OutputFormat, type ScopeType, type VarType } from "../lib/types";
import { SettingsDrawer, type TokenListItem } from "./settings-drawer";

type Mode = "local" | "cloud";
type Phase = "boot" | "setup" | "login" | "register" | "unlock" | "ready";
type Selection = { type: "public" } | { type: "server"; id: string } | { type: "project"; id: string };
type Account = {
  email: string;
  kdfSalt: string;
  kdfParams: { memory: number; iterations: number; parallelism: number };
  wrappedDek: string;
  dekIv: string;
};

type OutputChoice = OutputFormat | `builtin:${BuiltinId}` | `template:${string}`;

const FORMATS: OutputFormat[] = ["dotenv", "bash", "fish", "powershell", "cmd", "json", "yaml", "compose"];

export function Workbench() {
  const [mode, setMode] = useState<Mode>("local");
  const [phase, setPhase] = useState<Phase>("boot");
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [variables, setVariables] = useState<DecryptedVar[]>([]);
  const [versions, setVersions] = useState<StoredVersion[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; body: string }[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [selection, setSelection] = useState<Selection>({ type: "public" });
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<{ rows: { key: string; value: string; line: number }[]; errors: { line: number; error?: string }[] } | null>(null);
  const [fileImport, setFileImport] = useState<{ name: string; scope: Selection; rows: { key: string; value: string; line: number }[]; errors: { line: number; error: string }[] }[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [undo, setUndo] = useState<{ id: string; prev: DecryptedVar | null }[] | null>(null);
  const [undoLabel, setUndoLabel] = useState("撤销本次粘贴");
  const [transferIds, setTransferIds] = useState<string[] | null>(null);
  const [transferMode, setTransferMode] = useState<TransferMode>("move");
  const [transferConflict, setTransferConflict] = useState<ConflictPolicy>("skip");
  const [transferTarget, setTransferTarget] = useState<Selection>({ type: "public" });
  const [scopeMenu, setScopeMenu] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const [format, setFormat] = useState<OutputChoice>("dotenv");
  const [draft, setDraft] = useState({ key: "", value: "", note: "", type: "secret" as VarType });
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSample, setAiSample] = useState("");
  const [customTemplate, setCustomTemplate] = useState("");
  const dekRef = useRef<CryptoKey | null>(null);
  const metaRef = useRef<VaultMeta | null>(null);
  const snapRef = useRef<LocalSnapshot | null>(null);

  useEffect(() => {
    const savedMode = localStorage.getItem("env-vault:mode");
    const savedFormat = localStorage.getItem("env-vault:format");
    if (savedMode === "cloud" || savedMode === "local") setMode(savedMode);
    if (savedFormat) setFormat(savedFormat === "shell" ? "bash" : savedFormat as OutputChoice);
    void boot(savedMode === "cloud" ? "cloud" : "local");
    // boot reads storage itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function boot(nextMode: Mode) {
    setError("");
    let cloud = false;
    try {
      const health = await api<{ cloud: boolean }>("/api/health");
      cloud = health.cloud;
    } catch {
      cloud = false;
    }
    setCloudAvailable(cloud);
    if (nextMode === "cloud") {
      if (!cloud) {
        setPhase("login");
        setError("未配置 DATABASE_URL，仅本地模式可用");
        return;
      }
      try {
        const session = await api<{ authenticated: boolean } & Partial<Account>>("/api/auth/session");
        if (session.authenticated && session.email && session.kdfSalt && session.kdfParams && session.wrappedDek && session.dekIv) {
          const next = session as Account;
          setAccount(next);
          setEmail(next.email);
          metaRef.current = accountToMeta(next);
          setPhase("unlock");
          return;
        }
      } catch (err) {
        setError(messageOf(err));
      }
      setPhase("login");
      return;
    }
    const snap = await loadSnapshot();
    snapRef.current = snap;
    setPhase(snap ? "unlock" : "setup");
  }

  function rememberSelection(next: Selection) {
    setSelection(next);
    localStorage.setItem(`env-vault:scope:${mode}`, JSON.stringify(next));
  }

  function restoreSelection(nextMode: Mode, serverRows: ServerRecord[], projectRows: ProjectRecord[]) {
    const raw = localStorage.getItem(`env-vault:scope:${nextMode}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Selection;
      if (parsed.type === "public") setSelection(parsed);
      if (parsed.type === "server" && serverRows.some((row) => row.id === parsed.id)) setSelection(parsed);
      if (parsed.type === "project" && projectRows.some((row) => row.id === parsed.id)) setSelection(parsed);
    } catch {
      setSelection({ type: "public" });
    }
  }

  async function openDek(password: string, meta: VaultMeta) {
    try {
      const derived = await deriveKeys(password, meta.kdfSalt, {
        memory: meta.kdfMemory,
        iterations: meta.kdfIterations,
        parallelism: meta.kdfParallelism,
      });
      const dek = await unwrapDek(derived.encKey, meta.wrappedDek, meta.dekIv);
      if (meta.canaryCipher && !(await canaryMatches(dek, meta.canaryCipher, meta.canaryIv))) throw new Error("口令不正确");
      return dek;
    } catch (err) {
      if (err instanceof Error && err.message === "口令不正确") throw err;
      throw new Error("口令不正确");
    }
  }

  async function finishLocalUnlock(password: string) {
    const snap = snapRef.current ?? (await loadSnapshot());
    if (!snap) {
      setPhase("setup");
      return;
    }
    const dek = await openDek(password, snap.meta);
    dekRef.current = dek;
    metaRef.current = snap.meta;
    const opened = await Promise.all(snap.variables.map((row) => openStored(dek, row)));
    const openedTemplates = await Promise.all(snap.templates.map(async (row) => ({
      id: row.id,
      name: row.name,
      body: await aesDecrypt(dek, row.bodyCipher, row.bodyIv),
    })));
    snapRef.current = snap;
    setServers(snap.servers);
    setProjects(snap.projects);
    setLinks(snap.links);
    setVariables(opened);
    setVersions(snap.versions);
    setTemplates(openedTemplates);
    setAudits(trimAudits(snap.audits).reverse());
    restoreSelection("local", snap.servers, snap.projects);
    setPhase("ready");
  }

  async function finishCloudUnlock(password: string, current = account) {
    if (!current) throw new Error("请先登录");
    const meta = accountToMeta(current);
    const dek = await openDek(password, meta);
    dekRef.current = dek;
    metaRef.current = meta;
    const data = await api<Bootstrap>("/api/bootstrap");
    await applyBootstrap(dek, data);
    setPhase("ready");
  }

  async function applyBootstrap(dek: CryptoKey, data: Bootstrap) {
    const stored = data.variables.map(fromApiVar);
    const opened = await Promise.all(stored.map((row) => openStored(dek, row)));
    const openedTemplates = await Promise.all(data.templates.map(async (row) => ({
      id: row.id,
      name: row.name,
      body: await aesDecrypt(dek, row.bodyCipher, row.bodyIv),
    })));
    setServers(data.servers);
    setProjects(data.projects);
    setLinks(data.links);
    setVariables(opened);
    setVersions(data.versions.map(fromApiVersion));
    setTemplates(openedTemplates);
    restoreSelection("cloud", data.servers, data.projects);
    const audit = await api<{ items: AuditItem[] }>("/api/audit");
    setAudits(audit.items);
    const tokenRes = await api<{ items: TokenListItem[] }>("/api/tokens");
    setTokens(tokenRes.items);
  }

  async function createLocal(password: string) {
    const { raw, key } = await generateDek();
    const salt = newKdfSalt();
    const derived = await deriveKeys(password, salt, PROD_KDF);
    const wrapped = await buildMeta(derived.encKey, key, raw, salt);
    const snap = emptySnapshot(wrapped);
    await saveSnapshot(snap);
    snapRef.current = snap;
    dekRef.current = key;
    metaRef.current = wrapped;
    setServers([]);
    setProjects([]);
    setLinks([]);
    setVariables([]);
    setVersions([]);
    setTemplates([]);
    setAudits([]);
    setPhase("ready");
  }

  async function registerCloud(emailValue: string, password: string) {
    const { raw, key } = await generateDek();
    const salt = newKdfSalt();
    const derived = await deriveKeys(password, salt, PROD_KDF);
    const wrapped = await buildMeta(derived.encKey, key, raw, salt);
    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: emailValue,
        authKey: derived.authKeyB64,
        kdfSalt: salt,
        kdfMemory: PROD_KDF.memory,
        kdfIterations: PROD_KDF.iterations,
        kdfParallelism: PROD_KDF.parallelism,
        wrappedDek: wrapped.wrappedDek,
        dekIv: wrapped.dekIv,
      }),
    });
    const next: Account = {
      email: emailValue.trim().toLowerCase(),
      kdfSalt: salt,
      kdfParams: PROD_KDF,
      wrappedDek: wrapped.wrappedDek,
      dekIv: wrapped.dekIv,
    };
    setAccount(next);
    setEmail(next.email);
    metaRef.current = accountToMeta(next);
    dekRef.current = key;
    setVariables([]);
    setServers([]);
    setProjects([]);
    setLinks([]);
    setVersions([]);
    setTemplates([]);
    setAudits([]);
    setPhase("ready");
  }

  async function loginCloud(emailValue: string, password: string) {
    const pre = await api<Account>("/api/auth/prelogin", { method: "POST", body: JSON.stringify({ email: emailValue }) });
    const derived = await deriveKeys(password, pre.kdfSalt, pre.kdfParams);
    const logged = await api<Account & { ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: emailValue, authKey: derived.authKeyB64 }),
    });
    setAccount(logged);
    setEmail(logged.email);
    await finishCloudUnlock(password, logged);
  }

  function lock() {
    dekRef.current = null;
    setVariables([]);
    setRevealed([]);
    setSettings(false);
    setPhase(mode === "cloud" && account ? "unlock" : mode === "cloud" ? "login" : snapRef.current ? "unlock" : "setup");
  }

  async function switchMode(next: Mode) {
    localStorage.setItem("env-vault:mode", next);
    setMode(next);
    setSettings(false);
    dekRef.current = null;
    setVariables([]);
    setRevealed([]);
    await boot(next);
  }

  const scopeId = selection.type === "public" ? null : selection.id;
  const serverOrder = useMemo(() => {
    if (selection.type !== "project") return [];
    return links.filter((link) => link.projectId === selection.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.serverId);
  }, [links, selection]);

  const groups = useMemo(() => {
    const view = selection.type === "public"
      ? { type: "public" as const }
      : selection.type === "server"
        ? { type: "server" as const, serverId: selection.id }
        : { type: "project" as const, projectId: selection.id };
    return mergeEffective(variables, view, serverOrder);
  }, [variables, selection, serverOrder]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) => {
      const notes = [group.winner.note, ...group.overridden.map((row) => row.note)].join(" ").toLowerCase();
      return group.key.toLowerCase().includes(q) || notes.includes(q);
    });
  }, [groups, query]);

  const active = activeEntries(visible);
  const checkedActive = active.filter((row) => checked.includes(row.id));
  const exportRows = checkedActive.length ? checkedActive : active;
  const importStats = fileImport ? summarizeImport(
    variables.map((row) => ({ scopeType: row.scopeType, scopeId: row.scopeId, key: row.key })),
    fileImport.map((file) => ({ target: { scopeType: file.scope.type, scopeId: file.scope.type === "public" ? null : file.scope.id }, rows: file.rows, errorCount: file.errors.length })),
  ) : null;

  function scopeNameOf(type: ScopeType, id: string | null) {
    if (type === "public") return "公共";
    if (type === "server") return servers.find((row) => row.id === id)?.name ?? "服务器";
    return projects.find((row) => row.id === id)?.name ?? "项目";
  }

  async function audit(action: AuditItem["action"], extra: Partial<AuditItem> = {}) {
    const item: AuditItem = {
      id: crypto.randomUUID(),
      action,
      result: extra.result ?? "ok",
      scopeType: extra.scopeType ?? selection.type,
      scopeName: extra.scopeName ?? scopeNameOf(selection.type, scopeId),
      keyName: extra.keyName,
      meta: extra.meta,
      createdAt: new Date().toISOString(),
    };
    if (mode === "local") {
      await updateLocal((snap) => ({ ...snap, audits: trimAudits([...snap.audits, item]) }));
      setAudits((current) => [item, ...current].slice(0, 200));
      return;
    }
    await api("/api/audit", { method: "POST", body: JSON.stringify(item) });
    setAudits((current) => [item, ...current]);
  }

  async function updateLocal(mutator: (snap: LocalSnapshot) => LocalSnapshot) {
    const current = snapRef.current;
    if (!current) return;
    const next = mutator(current);
    snapRef.current = next;
    await saveSnapshot(next);
  }

  async function saveVariable(input: { id?: string; key: string; value: string; note: string; type: VarType; scopeType?: ScopeType; scopeId?: string | null }): Promise<DecryptedVar> {
    const dek = dekRef.current;
    if (!dek) throw new Error("请先解锁");
    if (!KEY_RE.test(input.key)) throw new Error("key 不合法");
    if (new TextEncoder().encode(input.value).length > MAX_VALUE_BYTES) throw new Error("值过长");
    if (input.note.length > MAX_NOTE_CHARS) throw new Error("备注过长");
    const targetType = input.scopeType ?? selection.type;
    const targetId = input.scopeId === undefined ? scopeId : input.scopeId;
    const now = new Date().toISOString();
    const snapExisting = snapRef.current?.variables.find((row) => row.scopeType === targetType && row.scopeId === targetId && row.key === input.key);
    const existing = variables.find((row) => row.scopeType === targetType && row.scopeId === targetId && row.key === input.key);
    const id = existing?.id ?? snapExisting?.id ?? input.id ?? crypto.randomUUID();
    const sealed = await sealStored(dek, {
      id,
      scopeType: targetType,
      scopeId: targetId,
      key: input.key,
      type: input.type,
      value: input.value,
      note: input.note,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (mode === "local") {
      await updateLocal((snap) => {
        const versionsNext = existing
          ? trimVersionList([...snap.versions, versionFrom(existing, "user")], id)
          : snap.versions;
        const without = snap.variables.filter((row) => row.id !== id);
        return { ...snap, variables: [...without, sealed], versions: versionsNext };
      });
      if (existing) setVersions((current) => trimVersionList([...current, versionFrom(existing, "user")], id));
    } else {
      const saved = await api<ApiVar>("/api/variables", {
        method: "POST",
        body: JSON.stringify(toApiCipher(sealed)),
      });
      sealed.id = saved.id;
      sealed.updatedAt = saved.updatedAt;
      const versionRes = await api<{ items: StoredVersion[] }>(`/api/variables/${saved.id}/versions`);
      setVersions((current) => [...current.filter((item) => item.variableId !== saved.id), ...versionRes.items]);
    }
    const opened = await openStored(dek, sealed);
    setVariables((current) => {
      const without = current.filter((row) => row.id !== opened.id && !(row.scopeType === opened.scopeType && row.scopeId === opened.scopeId && row.key === opened.key));
      return [...without, opened];
    });
    return opened;
  }

  async function removeVariable(id: string) {
    const row = variables.find((item) => item.id === id);
    if (!row) return;
    if (mode === "local") {
      await updateLocal((snap) => ({
        ...snap,
        variables: snap.variables.filter((item) => item.id !== id),
        versions: snap.versions.filter((item) => item.variableId !== id),
        audits: snap.audits,
      }));
      await audit("var_delete", { keyName: row.key });
    } else {
      await api(`/api/variables/${id}`, { method: "DELETE" });
    }
    setVariables((current) => current.filter((item) => item.id !== id));
  }

  async function commitPaste() {
    if (!preview) return;
    const dek = dekRef.current;
    if (!dek) return;
    const batchUndo: { id: string; prev: DecryptedVar | null }[] = [];
    for (const row of preview.rows) {
      const existing = variables.find((item) => item.scopeType === selection.type && item.scopeId === scopeId && item.key === row.key);
      const saved = await saveVariable({ key: row.key, value: row.value, note: existing?.note ?? "", type: existing?.type ?? "secret" });
      batchUndo.push({ id: saved.id, prev: existing ?? null });
    }
    setUndo(batchUndo);
    setUndoLabel("撤销本次粘贴");
    setPreview(null);
    setPaste("");
    await audit("paste", { meta: { count: preview.rows.length } });
    setNotice(`已入库 ${preview.rows.length} 条`);
  }

  async function undoLast() {
    if (!undo) return;
    for (const item of [...undo].reverse()) {
      if (!item.prev) await removeVariable(item.id);
      else {
        await saveVariable({
          id: item.prev.id,
          key: item.prev.key,
          value: item.prev.value,
          note: item.prev.note,
          type: item.prev.type,
          scopeType: item.prev.scopeType,
          scopeId: item.prev.scopeId,
        });
      }
    }
    setUndo(null);
    setNotice("已撤销上一批");
  }

  async function readImportFiles(files: FileList | File[]) {
    const parsed = [];
    for (const file of [...files]) {
      const text = await file.text();
      const result = parseImportFile(file.name, text);
      parsed.push({ name: file.name, scope: selection, rows: result.rows, errors: result.errors });
    }
    setFileImport(parsed);
  }

  async function commitFileImport() {
    if (!fileImport) return;
    const stats = summarizeImport(
      variables.map((row) => ({ scopeType: row.scopeType, scopeId: row.scopeId, key: row.key })),
      fileImport.map((file) => ({ target: { scopeType: file.scope.type, scopeId: file.scope.type === "public" ? null : file.scope.id }, rows: file.rows, errorCount: file.errors.length })),
    );
    if (stats.blocked) return;
    const batchUndo: { id: string; prev: DecryptedVar | null }[] = [];
    let working = [...variables];
    for (const file of fileImport) {
      const targetType = file.scope.type;
      const targetId = file.scope.type === "public" ? null : file.scope.id;
      let added = 0;
      let overwritten = 0;
      for (const row of file.rows) {
        const existing = working.find((item) => item.scopeType === targetType && item.scopeId === targetId && item.key === row.key);
        const saved = await saveVariable({ key: row.key, value: row.value, note: existing?.note ?? "", type: existing?.type ?? "secret", scopeType: targetType, scopeId: targetId });
        batchUndo.push({ id: saved.id, prev: existing ?? null });
        working = working.filter((item) => item.id !== saved.id && !(item.scopeType === targetType && item.scopeId === targetId && item.key === row.key));
        working.push(saved);
        if (existing) overwritten += 1;
        else added += 1;
      }
      await audit("import", {
        scopeType: targetType,
        scopeName: scopeNameOf(targetType, targetId),
        meta: { imported: added, overwritten, failed: file.errors.length, keys: file.rows.map((row) => row.key) },
      });
    }
    setUndo(batchUndo);
    setUndoLabel("撤销本次导入");
    setFileImport(null);
    setNotice(`新增 ${stats.added} / 覆盖 ${stats.overwritten} / 失败 ${stats.failed}`);
  }

  async function commitTransfer() {
    if (!transferIds?.length) return;
    const target = { type: transferTarget.type, id: transferTarget.type === "public" ? null : transferTarget.id };
    if (mode === "cloud") {
      await api("/api/variables/transfer", {
        method: "POST",
        body: JSON.stringify({
          ids: transferIds,
          targetScopeType: target.type,
          targetServerId: target.type === "server" ? target.id : null,
          targetProjectId: target.type === "project" ? target.id : null,
          mode: transferMode,
          conflict: transferConflict,
        }),
      });
      const dek = dekRef.current;
      if (dek) await applyBootstrap(dek, await api<Bootstrap>("/api/bootstrap"));
    } else {
      const plan = planTransfer({
        variables,
        ids: transferIds,
        target,
        mode: transferMode,
        conflict: transferConflict,
        newId: () => crypto.randomUUID(),
      });
      const now = new Date().toISOString();
      await updateLocal((snap) => {
        let nextVars = snap.variables.map((row) => ({ ...row }));
        let nextVersions = [...snap.versions];
        for (const op of plan.ops) {
          if (op.op === "delete") {
            nextVars = nextVars.filter((row) => row.id !== op.id);
            nextVersions = nextVersions.filter((row) => row.variableId !== op.id);
          } else if (op.op === "move") {
            nextVars = nextVars.map((row) => row.id === op.id ? { ...row, key: op.key, scopeType: op.scopeType, scopeId: op.scopeId, updatedAt: now } : row);
          } else if (op.op === "copy") {
            const source = nextVars.find((row) => row.id === op.sourceId);
            if (source) nextVars.push({ ...source, id: op.newId, key: op.key, scopeType: op.scopeType, scopeId: op.scopeId, createdAt: now, updatedAt: now });
          } else if (op.op === "overwrite-copy") {
            const source = nextVars.find((row) => row.id === op.sourceId);
            const hit = nextVars.find((row) => row.id === op.targetId);
            if (source && hit) {
              nextVersions.push({ id: crypto.randomUUID(), variableId: hit.id, valueCipher: hit.valueCipher, valueIv: hit.valueIv, noteCipher: hit.noteCipher, noteIv: hit.noteIv, type: hit.type, actor: "transfer", createdAt: now });
              Object.assign(hit, { valueCipher: source.valueCipher, valueIv: source.valueIv, noteCipher: source.noteCipher, noteIv: source.noteIv, type: source.type, updatedAt: now });
            }
          }
        }
        return { ...snap, variables: nextVars, versions: nextVersions.slice(-5000) };
      });
      const snap = snapRef.current;
      const dek = dekRef.current;
      if (snap && dek) {
        setVariables(await Promise.all(snap.variables.map((row) => openStored(dek, row))));
        setVersions(snap.versions);
      }
      const keys = variables.filter((row) => transferIds.includes(row.id)).map((row) => row.key);
      const sources = [...new Set(variables.filter((row) => transferIds.includes(row.id)).map((row) => scopeNameOf(row.scopeType, row.scopeId)))];
      await audit("transfer", {
        scopeType: target.type,
        scopeName: scopeNameOf(target.type, target.id),
        keyName: keys.length === 1 ? keys[0] : undefined,
        meta: { mode: transferMode, source: sources.join(",").slice(0, 80), target: scopeNameOf(target.type, target.id), keys, ...plan.counts },
      });
    }
    setTransferIds(null);
    setChecked([]);
    setNotice("转移完成。相关生效集已变化。");
  }

  async function restore(variableId: string, versionId: string) {
    const dek = dekRef.current;
    if (!dek) return;
    if (mode === "cloud") {
      const saved = await api<ApiVar>(`/api/variables/${variableId}/restore`, {
        method: "POST",
        body: JSON.stringify({ versionId }),
      });
      const stored = fromApiVar(saved);
      const opened = await openStored(dek, stored);
      setVariables((current) => current.map((row) => row.id === opened.id ? opened : row));
      return;
    }
    const version = versions.find((item) => item.id === versionId && item.variableId === variableId);
    const current = variables.find((item) => item.id === variableId);
    if (!version || !current) return;
    const restored = await openStored(dek, {
      ...stripPlain(current),
      valueCipher: version.valueCipher,
      valueIv: version.valueIv,
      noteCipher: version.noteCipher,
      noteIv: version.noteIv,
      type: version.type,
      updatedAt: new Date().toISOString(),
    });
    await saveVariable({ id: current.id, key: restored.key, value: restored.value, note: restored.note, type: restored.type });
    await audit("var_restore", { keyName: current.key });
  }

  function outputText(): { text: string; missing: string[]; filename: string } {
    const entries = exportRows.map((row) => ({ key: row.key, value: row.value }));
    const map = Object.fromEntries(entries.map((row) => [row.key, row.value]));
    if (format.startsWith("builtin:")) {
      const id = format.slice(8) as BuiltinId;
      const tpl = builtinTemplate(id, entries.map((row) => row.key));
      const filled = fillTemplate(tpl.body, map, { base64: tpl.base64 });
      return { text: filled.text, missing: filled.missing, filename: tpl.ext };
    }
    if (format.startsWith("template:")) {
      const id = format.slice(9);
      const body = templates.find((item) => item.id === id)?.body ?? customTemplate;
      const filled = fillTemplate(body, map);
      return { text: filled.text, missing: filled.missing, filename: "template.txt" };
    }
    if (customTemplate && format === "dotenv" && customTemplate.includes("{{vault:")) {
      const filled = fillTemplate(customTemplate, map);
      return { text: filled.text, missing: filled.missing, filename: "template.txt" };
    }
    return { text: renderFormat(format as OutputFormat, entries), missing: [], filename: fileNameFor(format as OutputFormat) };
  }

  const rendered = phase === "ready" ? outputText() : { text: "", missing: [] as string[], filename: ".env" };

  async function copyOutput() {
    await navigator.clipboard.writeText(rendered.text);
    await audit("copy", { meta: { format: String(format), count: exportRows.length } });
    setNotice("已复制");
  }

  function downloadOutput() {
    const blob = new Blob([rendered.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = rendered.filename;
    link.click();
    URL.revokeObjectURL(url);
    void audit("download", { meta: { format: String(format), count: exportRows.length } });
  }

  async function askAi() {
    const keyNames = exportRows.map((row) => row.key);
    const result = await api<{ template: string }>("/api/ai/template", {
      method: "POST",
      body: JSON.stringify({ description: aiPrompt, sample: aiSample, keyNames }),
    });
    setCustomTemplate(result.template);
    setFormat("dotenv");
    setNotice("已生成模板，值仍在本地填充");
  }

  async function saveCustomTemplate() {
    const dek = dekRef.current;
    if (!dek || !customTemplate.trim()) return;
    const name = `模板 ${new Date().toLocaleString("zh-CN")}`;
    const body = await sealTemplate(dek, name, customTemplate);
    if (mode === "local") {
      await updateLocal((snap) => ({ ...snap, templates: [...snap.templates, body] }));
    } else {
      const saved = await api<{ id: string }>("/api/templates", { method: "POST", body: JSON.stringify(body) });
      body.id = saved.id;
    }
    setTemplates((current) => [...current, { id: body.id, name, body: customTemplate }]);
    setNotice("模板已保存");
  }

  function exportBackup() {
    const meta = metaRef.current;
    if (!meta) return;
    const file: BackupFile = {
      format: "env-vault-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      kdf: { salt: meta.kdfSalt, memory: meta.kdfMemory, iterations: meta.kdfIterations, parallelism: meta.kdfParallelism },
      wrappedDek: meta.wrappedDek,
      dekIv: meta.dekIv,
      servers: servers.map((row) => ({ name: row.name, note: row.note })),
      projects: projects.map((row) => ({
        name: row.name,
        note: row.note,
        serverNames: links.filter((link) => link.projectId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => servers.find((server) => server.id === link.serverId)?.name ?? "").filter(Boolean),
      })),
      variables: variables.map((row) => ({
        scopeType: row.scopeType,
        scopeName: row.scopeType === "public" ? "" : scopeNameOf(row.scopeType, row.scopeId),
        key: row.key,
        type: row.type,
        valueCipher: row.valueCipher,
        valueIv: row.valueIv,
        noteCipher: row.noteCipher,
        noteIv: row.noteIv,
        updatedAt: row.updatedAt,
      })),
      templates: [],
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "env-vault-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    void audit("backup_export", { meta: { count: file.variables.length } });
  }

  async function importBackup(file: File, passphrase: string) {
    const dek = dekRef.current;
    if (!dek) throw new Error("请先解锁");
    const parsed = parseBackup(JSON.parse(await file.text()));
    const derived = await deriveKeys(passphrase, parsed.kdf.salt, parsed.kdf);
    const backupDek = await unwrapDek(derived.encKey, parsed.wrappedDek, parsed.dekIv);
    const plain: BackupVariable[] = [];
    for (const row of parsed.variables) {
      plain.push({
        scopeType: row.scopeType,
        scopeName: row.scopeName,
        key: row.key,
        type: row.type,
        value: await aesDecrypt(backupDek, row.valueCipher, row.valueIv),
        note: row.noteCipher && row.noteIv ? await aesDecrypt(backupDek, row.noteCipher, row.noteIv) : "",
        updatedAt: row.updatedAt,
      });
    }
    if (mode === "cloud") {
      await pushMigration(dek, parsed.servers, parsed.projects, plain);
    } else {
      await mergeLocalPlain(dek, parsed.servers, parsed.projects, plain);
    }
    await audit("backup_import", { meta: { count: plain.length } });
  }

  async function migrateLocal(passphrase: string) {
    const dek = dekRef.current;
    if (!dek || mode !== "cloud") throw new Error("请在已解锁的云端模式迁移");
    const snap = await loadSnapshot();
    if (!snap) throw new Error("没有本地保险库");
    const localDek = await openDek(passphrase, snap.meta);
    const plain: BackupVariable[] = [];
    for (const row of snap.variables) {
      const opened = await openStored(localDek, row);
      plain.push({
        scopeType: row.scopeType,
        scopeName: row.scopeType === "public" ? "" : row.scopeType === "server"
          ? snap.servers.find((server) => server.id === row.scopeId)?.name ?? ""
          : snap.projects.find((project) => project.id === row.scopeId)?.name ?? "",
        key: row.key,
        type: row.type,
        value: opened.value,
        note: opened.note,
        updatedAt: row.updatedAt,
      });
    }
    const cloudPlain: BackupVariable[] = variables.map((row) => ({
      scopeType: row.scopeType,
      scopeName: row.scopeType === "public" ? "" : scopeNameOf(row.scopeType, row.scopeId),
      key: row.key,
      type: row.type,
      value: row.value,
      note: row.note,
      updatedAt: row.updatedAt,
    }));
    const counts = migrationCounts(plain, cloudPlain);
    const ok = window.confirm(`将新增 ${counts.added} 条，覆盖 ${counts.overwritten} 条。不会显示值。继续？`);
    if (!ok) return "已取消";
    await pushMigration(
      dek,
      snap.servers.map((row) => ({ name: row.name, note: row.note })),
      snap.projects.map((row) => ({
        name: row.name,
        note: row.note,
        serverNames: snap.links.filter((link) => link.projectId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => snap.servers.find((server) => server.id === link.serverId)?.name ?? "").filter(Boolean),
      })),
      plain,
    );
    return `已迁移：新增 ${counts.added}，覆盖 ${counts.overwritten}`;
  }

  async function pushMigration(
    dek: CryptoKey,
    serverRows: { name: string; note: string }[],
    projectRows: { name: string; note: string; serverNames: string[] }[],
    plain: BackupVariable[],
  ) {
    const variablesPayload = [];
    for (const row of plain) {
      const sealed = await sealStored(dek, {
        id: crypto.randomUUID(),
        scopeType: row.scopeType,
        scopeId: null,
        key: row.key,
        type: row.type,
        value: row.value,
        note: row.note,
        createdAt: row.updatedAt,
        updatedAt: row.updatedAt,
      });
      variablesPayload.push({ ...toApiCipher(sealed), scopeName: row.scopeName });
    }
    await api("/api/migrate", {
      method: "POST",
      body: JSON.stringify({ servers: serverRows, projects: projectRows, variables: variablesPayload, templates: [] }),
    });
    const data = await api<Bootstrap>("/api/bootstrap");
    await applyBootstrap(dek, data);
  }

  async function mergeLocalPlain(
    dek: CryptoKey,
    serverRows: { name: string; note: string }[],
    projectRows: { name: string; note: string; serverNames: string[] }[],
    plain: BackupVariable[],
  ) {
    const snap = snapRef.current;
    if (!snap) return;
    const next = structuredClone(snap);
    for (const server of serverRows) {
      if (!next.servers.some((row) => row.name === server.name)) {
        next.servers.push({ id: crypto.randomUUID(), name: server.name, note: server.note, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    }
    for (const project of projectRows) {
      let current = next.projects.find((row) => row.name === project.name);
      if (!current) {
        current = { id: crypto.randomUUID(), name: project.name, note: project.note, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        next.projects.push(current);
      }
      next.links = next.links.filter((link) => link.projectId !== current?.id);
      project.serverNames.forEach((name, index) => {
        const server = next.servers.find((row) => row.name === name);
        if (server && current) next.links.push({ projectId: current.id, serverId: server.id, sortOrder: index });
      });
    }
    for (const row of plain) {
      const scopeIdValue = row.scopeType === "public" ? null : row.scopeType === "server"
        ? next.servers.find((server) => server.name === row.scopeName)?.id ?? null
        : next.projects.find((project) => project.name === row.scopeName)?.id ?? null;
      const sealed = await sealStored(dek, {
        id: next.variables.find((item) => item.scopeType === row.scopeType && item.scopeId === scopeIdValue && item.key === row.key)?.id ?? crypto.randomUUID(),
        scopeType: row.scopeType,
        scopeId: scopeIdValue,
        key: row.key,
        type: row.type,
        value: row.value,
        note: row.note,
        createdAt: row.updatedAt,
        updatedAt: new Date().toISOString(),
      });
      next.variables = next.variables.filter((item) => item.id !== sealed.id);
      next.variables.push(sealed);
    }
    snapRef.current = next;
    await saveSnapshot(next);
    setServers(next.servers);
    setProjects(next.projects);
    setLinks(next.links);
    setVariables(await Promise.all(next.variables.map((row) => openStored(dek, row))));
  }

  async function createToken(input: {
    name: string;
    scopeType: ScopeType;
    scopeId: string | null;
    canInject: boolean;
    canReplace: boolean;
    expiresAt: string;
  }) {
    const dek = dekRef.current;
    if (!dek) throw new Error("请先解锁");
    const raw = await exportDekRaw(dek);
    const pair = await generateRsaWrapPair();
    const wrapped = await rsaWrapDek(pair.publicSpkiB64, raw);
    const auth = await newAuthSecret();
    const publicId = crypto.randomUUID();
    await api("/api/tokens", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        publicId,
        authSecretHash: auth.hash,
        publicKeySpki: pair.publicSpkiB64,
        wrappedDek: wrapped,
        scopeType: input.scopeType,
        serverId: input.scopeType === "server" ? input.scopeId : null,
        projectId: input.scopeType === "project" ? input.scopeId : null,
        canInject: input.canInject,
        canReplace: input.canReplace,
        expiresAt: input.expiresAt,
      }),
    });
    const list = await api<{ items: TokenListItem[] }>("/api/tokens");
    setTokens(list.items);
    return buildTokenString(publicId, auth.secretB64Url, pair.privatePkcs8B64Url);
  }

  const gate = phase !== "ready";

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-3 py-4 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">env-vault</p>
          <h1 className="text-2xl font-semibold">环境变量保险柜</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded border border-line px-3 py-2">{mode === "local" ? "本地" : "云端"}{email ? ` · ${email}` : ""}</span>
          <button type="button" className="rounded border border-line px-3 py-2" onClick={() => setSettings(true)}>设置</button>
        </div>
      </header>
      {error ? <p className="mb-3 rounded border border-danger px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-lime">{notice}</p> : null}
      {gate ? (
        <Gate
          phase={phase}
          mode={mode}
          email={email}
          busy={busy}
          onSubmit={async (payload) => {
            setBusy(true);
            setError("");
            try {
              if (payload.kind === "setup") await createLocal(payload.password);
              if (payload.kind === "unlock" && mode === "local") await finishLocalUnlock(payload.password);
              if (payload.kind === "unlock" && mode === "cloud") await finishCloudUnlock(payload.password);
              if (payload.kind === "login") await loginCloud(payload.email, payload.password);
              if (payload.kind === "register") await registerCloud(payload.email, payload.password);
            } catch (err) {
              setError(messageOf(err));
            } finally {
              setBusy(false);
            }
          }}
          onWant={(next) => setPhase(next)}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className="w-full rounded border border-line bg-panel px-3 py-3"
                value={selection.type === "public" ? "public" : `${selection.type}:${selection.id}`}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "public") rememberSelection({ type: "public" });
                  else if (value.startsWith("server:")) rememberSelection({ type: "server", id: value.slice(7) });
                  else rememberSelection({ type: "project", id: value.slice(8) });
                  setChecked([]);
                }}
              >
                <option value="public">公共层</option>
                {servers.map((server) => <option key={server.id} value={`server:${server.id}`}>服务器 · {server.name}</option>)}
                {projects.map((project) => <option key={project.id} value={`project:${project.id}`}>项目 · {project.name}</option>)}
              </select>
              <input className="w-full rounded border border-line bg-panel px-3 py-3" placeholder="搜索 key 或备注" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <form
              className="rounded border border-line bg-panel p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = parseDotenv(paste);
                setPreview(parsed);
              }}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm text-mute">粘贴 KEY=VALUE，确认后写入当前作用域</label>
                <label className="cursor-pointer rounded border border-line px-3 py-2 text-sm">
                  导入文件
                  <input type="file" multiple accept=".env,.json,.yaml,.yml" className="hidden" onChange={(event) => { if (event.target.files?.length) void readImportFiles(event.target.files); event.target.value = ""; }} />
                </label>
              </div>
              <textarea
                className={`h-24 w-full rounded border bg-ink p-2 font-mono text-sm ${dragging ? "border-lime" : "border-line"}`}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={"FOO=bar\nexport TOKEN=***"}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void readImportFiles(event.dataTransfer.files); }}
              />
              <button type="submit" className="mt-2 rounded border border-line px-3 py-2 text-sm">解析</button>
            </form>
            {fileImport && importStats ? (
              <div className="rounded border border-line p-3 text-sm">
                <p>文件导入预览。解析只在浏览器里进行。</p>
                {fileImport.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="mt-3 border-t border-line pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{file.name}</span>
                      <select
                        className="rounded border border-line bg-ink px-2 py-2"
                        value={file.scope.type === "public" ? "public" : `${file.scope.type}:${file.scope.id}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          const scope: Selection = value === "public" ? { type: "public" } : value.startsWith("server:") ? { type: "server", id: value.slice(7) } : { type: "project", id: value.slice(8) };
                          setFileImport((current) => current?.map((item, itemIndex) => itemIndex === index ? { ...item, scope } : item) ?? null);
                        }}
                      >
                        <option value="public">公共层</option>
                        {servers.map((server) => <option key={server.id} value={`server:${server.id}`}>服务器 · {server.name}</option>)}
                        {projects.map((project) => <option key={project.id} value={`project:${project.id}`}>项目 · {project.name}</option>)}
                      </select>
                      <span className="text-mute">{file.rows.length} 条</span>
                    </div>
                    {file.errors.map((item) => <p key={`${file.name}-${item.line}-${item.error}`} className="text-danger">第 {item.line} 行：{item.error}</p>)}
                  </div>
                ))}
                <p className="mt-3">新增 {importStats.added} / 覆盖 {importStats.overwritten} / 失败 {importStats.failed}</p>
                {importStats.blocked ? <p className="text-danger">超过 500 条，请减少文件后再确认。</p> : null}
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={importStats.blocked || importStats.added + importStats.overwritten === 0} className="rounded bg-lime px-3 py-2 text-ink disabled:opacity-40" onClick={() => void commitFileImport().catch((err) => setError(messageOf(err)))}>确认导入</button>
                  <button type="button" className="rounded border border-line px-3 py-2" onClick={() => setFileImport(null)}>取消</button>
                </div>
              </div>
            ) : null}
            {preview ? (
              <div className="rounded border border-line p-3 text-sm">
                <p>可入库 {preview.rows.length} 条{preview.errors.length ? `，${preview.errors.length} 行无效` : ""}</p>
                {preview.errors.map((item) => <p key={item.line} className="text-danger">第 {item.line} 行：{item.error}</p>)}
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded bg-lime px-3 py-2 text-ink" onClick={() => void commitPaste()}>确认入库</button>
                  <button type="button" className="rounded border border-line px-3 py-2" onClick={() => setPreview(null)}>取消</button>
                </div>
              </div>
            ) : null}
            {undo ? <button type="button" className="text-sm text-lime" onClick={() => void undoLast()}>{undoLabel}</button> : null}
            <div className="relative flex flex-wrap items-center gap-2">
              <button type="button" className="rounded border border-line px-3 py-2 text-sm" onClick={() => setScopeMenu((open) => !open)} aria-label="作用域菜单">···</button>
              {scopeMenu ? (
                <button type="button" className="rounded border border-line bg-panel px-3 py-2 text-sm" onClick={() => { setTransferIds(variables.filter((row) => row.scopeType === selection.type && row.scopeId === scopeId).map((row) => row.id)); setTransferMode("move"); setTransferConflict("skip"); setScopeMenu(false); }}>转移全部变量…</button>
              ) : null}
              {checked.length ? <button type="button" className="rounded border border-line px-3 py-2 text-sm" onClick={() => { setTransferIds(checked); setTransferMode("move"); setTransferConflict("skip"); }}>转移到…</button> : null}
            </div>
            <form
              className="grid gap-2 sm:grid-cols-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                try {
                  await saveVariable(draft);
                  setDraft({ key: "", value: "", note: "", type: "secret" });
                } catch (err) {
                  setError(messageOf(err));
                }
              }}
            >
              <input className="rounded border border-line bg-panel px-3 py-2 font-mono" placeholder="KEY" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
              <input className="rounded border border-line bg-panel px-3 py-2 font-mono" placeholder="值" type="password" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
              <input className="rounded border border-line bg-panel px-3 py-2" placeholder="备注" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              <select className="rounded border border-line bg-panel px-3 py-2" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as VarType })}>
                <option value="secret">密钥</option>
                <option value="plain">普通</option>
              </select>
              <button type="submit" className="rounded bg-lime px-3 py-2 text-ink sm:col-span-4">保存到当前层</button>
            </form>
            <div className="overflow-hidden rounded border border-line">
              {visible.length === 0 ? <p className="p-4 text-sm text-mute">这个作用域还没有变量。</p> : null}
              {visible.map((group) => (
                <div key={group.key}>
                  <VarRow
                    row={group.winner}
                    gray={false}
                    checked={checked.includes(group.winner.id)}
                    revealed={revealed.includes(group.winner.id)}
                    source={`${scopeRankLabel(group.winner.scopeType)} · ${scopeNameOf(group.winner.scopeType, group.winner.scopeId)}`}
                    onCheck={(on) => setChecked((current) => on ? [...current, group.winner.id] : current.filter((id) => id !== group.winner.id))}
                    onReveal={() => setPendingReveal(group.winner.id)}
                    onTransfer={() => { setTransferIds([group.winner.id]); setTransferMode("move"); setTransferConflict("skip"); }}
                    onDelete={() => void removeVariable(group.winner.id)}
                    versions={versions.filter((item) => item.variableId === group.winner.id)}
                    onRestore={(versionId) => void restore(group.winner.id, versionId)}
                  />
                  {group.overridden.map((row) => (
                    <VarRow
                      key={row.id}
                      row={row}
                      gray
                      checked={checked.includes(row.id)}
                      revealed={revealed.includes(row.id)}
                      source={`${scopeRankLabel(row.scopeType)} · ${scopeNameOf(row.scopeType, row.scopeId)} · 已覆盖`}
                      onCheck={(on) => setChecked((current) => on ? [...current, row.id] : current.filter((id) => id !== row.id))}
                      onReveal={() => setPendingReveal(row.id)}
                      onTransfer={() => { setTransferIds([row.id]); setTransferMode("move"); setTransferConflict("skip"); }}
                      onDelete={() => void removeVariable(row.id)}
                      versions={[]}
                      onRestore={() => undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <div className="rounded border border-line bg-panel p-3">
              <label className="mb-2 block text-sm text-mute">输出格式</label>
              <select
                className="w-full rounded border border-line bg-ink px-3 py-3"
                value={format}
                onChange={(event) => {
                  const next = event.target.value as OutputChoice;
                  setFormat(next);
                  localStorage.setItem("env-vault:format", next);
                  if (next.startsWith("builtin:")) {
                    const id = next.slice(8) as BuiltinId;
                    setCustomTemplate(builtinTemplate(id, exportRows.map((row) => row.key)).body);
                  }
                }}
              >
                {FORMATS.map((item) => <option key={item} value={item}>{FORMAT_LABEL[item]}</option>)}
                {BUILTIN_LIST.map((item) => <option key={item.id} value={`builtin:${item.id}`}>{item.title}</option>)}
                {templates.map((item) => <option key={item.id} value={`template:${item.id}`}>{item.name}</option>)}
              </select>
              <p className="mt-2 text-xs text-mute">{checkedActive.length ? `将复制已勾选 ${exportRows.length} 条` : `将复制当前可见生效集 ${exportRows.length} 条`}</p>
              {format === "bash" || format === "shell" ? <p className="mt-1 text-xs text-mute">Bash/Zsh 可 eval。不要把输出重定向进日志。</p> : null}
              {format === "fish" ? <p className="mt-1 text-xs text-mute">Fish 用 source (命令 | psub)。不要把输出重定向进日志。</p> : null}
              {format === "powershell" ? <p className="mt-1 text-xs text-mute">PowerShell 可管道给 Invoke-Expression。不要把输出重定向进日志。</p> : null}
              {format === "cmd" ? <p className="mt-1 text-xs text-mute">CMD 不能安全表达换行和延迟展开。不要把输出重定向进日志。</p> : null}
              {rendered.missing.length ? <p className="mt-2 text-sm text-danger">缺少：{rendered.missing.join("、")}</p> : null}
              <pre className="mt-3 max-h-80 overflow-auto rounded bg-ink p-3 font-mono text-xs leading-5">{rendered.text || "（空）"}</pre>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="rounded bg-lime px-3 py-3 font-medium text-ink" onClick={() => void copyOutput()}>复制</button>
                <button type="button" className="rounded border border-line px-3 py-3" onClick={downloadOutput}>下载</button>
              </div>
            </div>
            <div className="rounded border border-line p-3 text-sm">
              <p className="mb-2 text-mute">AI 只接收 key 名和格式描述，不接收值。样例里不要贴真实密钥。</p>
              <textarea className="mb-2 h-16 w-full rounded border border-line bg-ink p-2" placeholder="想要的格式" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} />
              <textarea className="mb-2 h-16 w-full rounded border border-line bg-ink p-2 font-mono" placeholder="可选样例，不要包含真实值" value={aiSample} onChange={(e) => setAiSample(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded border border-line px-3 py-2" onClick={() => void askAi().catch((err) => setError(messageOf(err)))}>生成模板</button>
                <button type="button" className="rounded border border-line px-3 py-2" onClick={() => void saveCustomTemplate()}>保存模板</button>
                <button
                  type="button"
                  className="rounded border border-line px-3 py-2"
                  onClick={() => void navigator.clipboard.writeText(customTemplate || builtinTemplate("gha", exportRows.map((row) => row.key)).body)}
                >
                  复制占位模板
                </button>
              </div>
              {customTemplate ? <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs">{customTemplate}</pre> : null}
            </div>
          </section>
        </div>
      )}
      {transferIds ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded border border-line bg-panel p-4">
            <h2 className="text-lg font-semibold">转移到…</h2>
            <p className="text-sm text-mute">转移后相关生效集会变化。密文原样改归属，不会解密。</p>
            <select className="w-full rounded border border-line bg-ink px-3 py-2" value={transferTarget.type === "public" ? "public" : `${transferTarget.type}:${transferTarget.id}`} onChange={(event) => {
              const value = event.target.value;
              if (value === "public") setTransferTarget({ type: "public" });
              else if (value.startsWith("server:")) setTransferTarget({ type: "server", id: value.slice(7) });
              else setTransferTarget({ type: "project", id: value.slice(8) });
            }}>
              <option value="public">公共层</option>
              {servers.map((server) => <option key={server.id} value={`server:${server.id}`}>服务器 · {server.name}</option>)}
              {projects.map((project) => <option key={project.id} value={`project:${project.id}`}>项目 · {project.name}</option>)}
            </select>
            <label className="flex gap-2 text-sm"><input type="radio" checked={transferMode === "move"} onChange={() => setTransferMode("move")} />移动（源删除）</label>
            <label className="flex gap-2 text-sm"><input type="radio" checked={transferMode === "copy"} onChange={() => setTransferMode("copy")} />复制（源保留）</label>
            <label className="flex gap-2 text-sm"><input type="radio" checked={transferConflict === "skip"} onChange={() => setTransferConflict("skip")} />同名跳过</label>
            <label className="flex gap-2 text-sm"><input type="radio" checked={transferConflict === "overwrite"} onChange={() => setTransferConflict("overwrite")} />同名覆盖</label>
            <label className="flex gap-2 text-sm"><input type="radio" checked={transferConflict === "keep"} onChange={() => setTransferConflict("keep")} />保留两者（加 _copy 后缀）</label>
            <div className="flex gap-2">
              <button type="button" className="flex-1 rounded bg-lime px-3 py-3 text-ink" onClick={() => void commitTransfer().catch((err) => setError(messageOf(err)))}>确认转移</button>
              <button type="button" className="flex-1 rounded border border-line px-3 py-3" onClick={() => setTransferIds(null)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingReveal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded border border-line bg-panel p-4">
            <p>将显示明文并写入审计。值不会发给服务器。</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded bg-lime px-3 py-3 text-ink"
                onClick={() => {
                  setRevealed((current) => [...current, pendingReveal]);
                  const row = variables.find((item) => item.id === pendingReveal);
                  void audit("reveal", { keyName: row?.key });
                  setPendingReveal(null);
                }}
              >
                确认查看
              </button>
              <button type="button" className="flex-1 rounded border border-line px-3 py-3" onClick={() => setPendingReveal(null)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
      <SettingsDrawer
        open={settings}
        mode={mode}
        email={email}
        cloudAvailable={cloudAvailable}
        servers={servers}
        projects={projects}
        links={links}
        tokens={tokens}
        audits={audits}
        templates={templates}
        onClose={() => setSettings(false)}
        onMode={(next) => void switchMode(next)}
        onLock={lock}
        onLogout={() => void api("/api/auth/logout", { method: "POST" }).finally(() => {
          setAccount(null);
          setEmail(null);
          lock();
          setPhase("login");
        })}
        onCreateServer={async (name, note) => {
          if (mode === "local") {
            const row: ServerRecord = { id: crypto.randomUUID(), name, note, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            await updateLocal((snap) => ({ ...snap, servers: [...snap.servers, row] }));
            setServers((current) => [...current, row]);
          } else {
            const saved = await api<ServerRecord>("/api/servers", { method: "POST", body: JSON.stringify({ name, note }) });
            setServers((current) => [...current, saved]);
          }
        }}
        onDeleteServer={async (id) => {
          if (mode === "local") {
            await updateLocal((snap) => ({
              ...snap,
              servers: snap.servers.filter((row) => row.id !== id),
              links: snap.links.filter((row) => row.serverId !== id),
              variables: snap.variables.filter((row) => !(row.scopeType === "server" && row.scopeId === id)),
            }));
            setServers((current) => current.filter((row) => row.id !== id));
            setVariables((current) => current.filter((row) => !(row.scopeType === "server" && row.scopeId === id)));
          } else {
            await api(`/api/servers/${id}`, { method: "DELETE" });
            setServers((current) => current.filter((row) => row.id !== id));
            setVariables((current) => current.filter((row) => !(row.scopeType === "server" && row.scopeId === id)));
          }
        }}
        onCreateProject={async (name, note, serverIds) => {
          if (mode === "local") {
            const row: ProjectRecord = { id: crypto.randomUUID(), name, note, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            const nextLinks = serverIds.map((serverId, index) => ({ projectId: row.id, serverId, sortOrder: index }));
            await updateLocal((snap) => ({ ...snap, projects: [...snap.projects, row], links: [...snap.links, ...nextLinks] }));
            setProjects((current) => [...current, row]);
            setLinks((current) => [...current, ...nextLinks]);
          } else {
            const saved = await api<ProjectRecord>("/api/projects", { method: "POST", body: JSON.stringify({ name, note, serverIds }) });
            setProjects((current) => [...current, saved]);
            setLinks((current) => [...current, ...serverIds.map((serverId, index) => ({ projectId: saved.id, serverId, sortOrder: index }))]);
          }
        }}
        onUpdateProject={async (id, serverIds) => {
          const nextLinks = serverIds.map((serverId, index) => ({ projectId: id, serverId, sortOrder: index }));
          if (mode === "local") {
            await updateLocal((snap) => ({ ...snap, links: [...snap.links.filter((link) => link.projectId !== id), ...nextLinks] }));
          } else {
            await api(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ serverIds }) });
          }
          setLinks((current) => [...current.filter((link) => link.projectId !== id), ...nextLinks]);
        }}
        onDeleteProject={async (id) => {
          if (mode === "local") {
            await updateLocal((snap) => ({
              ...snap,
              projects: snap.projects.filter((row) => row.id !== id),
              links: snap.links.filter((row) => row.projectId !== id),
              variables: snap.variables.filter((row) => !(row.scopeType === "project" && row.scopeId === id)),
            }));
          } else {
            await api(`/api/projects/${id}`, { method: "DELETE" });
          }
          setProjects((current) => current.filter((row) => row.id !== id));
          setLinks((current) => current.filter((row) => row.projectId !== id));
          setVariables((current) => current.filter((row) => !(row.scopeType === "project" && row.scopeId === id)));
        }}
        onCreateToken={createToken}
        onRevokeToken={async (id) => {
          await api(`/api/tokens/${id}/revoke`, { method: "POST" });
          setTokens((current) => current.map((token) => token.id === id ? { ...token, revokedAt: new Date().toISOString() } : token));
        }}
        onExport={exportBackup}
        onImportFile={importBackup}
        onMigrate={migrateLocal}
        onDeleteTemplate={async (id) => {
          if (mode === "local") await updateLocal((snap) => ({ ...snap, templates: snap.templates.filter((row) => row.id !== id) }));
          else await api(`/api/templates/${id}`, { method: "DELETE" });
          setTemplates((current) => current.filter((row) => row.id !== id));
        }}
      />
    </main>
  );
}

function VarRow(props: {
  row: VarRef;
  gray: boolean;
  checked: boolean;
  revealed: boolean;
  source: string;
  versions: StoredVersion[];
  onCheck: (on: boolean) => void;
  onReveal: () => void;
  onTransfer: () => void;
  onDelete: () => void;
  onRestore: (versionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-t border-line px-3 py-3 ${props.gray ? "bg-ink text-mute" : "bg-panel"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={props.checked} onChange={(event) => props.onCheck(event.target.checked)} aria-label={`选择 ${props.row.key}`} />
        <span className="font-mono text-sm">{props.row.key}</span>
        <span className="font-mono text-sm text-mute">{props.revealed ? props.row.value : "••••••"}</span>
        <span className="text-xs text-mute">{props.source}</span>
        <span className="ml-auto flex flex-wrap gap-2 text-sm">
          <button type="button" className="rounded border border-line px-3 py-2" onClick={props.onReveal}>查看</button>
          <button type="button" className="rounded border border-line px-3 py-2" onClick={props.onTransfer}>转移到…</button>
          {!props.gray && props.versions.length ? <button type="button" className="rounded border border-line px-3 py-2" onClick={() => setOpen((value) => !value)}>历史</button> : null}
          <button type="button" className="rounded border border-line px-3 py-2 text-danger" onClick={props.onDelete}>删除</button>
        </span>
      </div>
      {props.row.note ? <p className="mt-1 pl-6 text-xs text-mute">{props.row.note}</p> : null}
      {open ? (
        <ul className="mt-2 space-y-1 pl-6 text-xs">
          {props.versions.map((version) => (
            <li key={version.id} className="flex items-center justify-between gap-2">
              <span>{new Date(version.createdAt).toLocaleString("zh-CN")}</span>
              <button type="button" onClick={() => props.onRestore(version.id)}>恢复</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Gate(props: {
  phase: Phase;
  mode: Mode;
  email: string | null;
  busy: boolean;
  onSubmit: (payload: { kind: "setup" | "unlock"; password: string } | { kind: "login" | "register"; email: string; password: string }) => Promise<void>;
  onWant: (phase: Phase) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const title = props.phase === "setup" ? "设置本地口令" : props.phase === "login" ? "云端登录" : props.phase === "unlock" ? "解锁" : "正在打开";
  return (
    <form
      className="mx-auto mt-10 max-w-md space-y-3 rounded border border-line bg-panel p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.phase === "setup" || props.phase === "register") {
          if (password.length < 10) return;
          if (password !== confirm) return;
        }
        if (props.phase === "setup" || props.phase === "unlock") void props.onSubmit({ kind: props.phase, password });
        if (props.phase === "login" || props.phase === "register") void props.onSubmit({ kind: props.phase, email, password });
      }}
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      {props.phase === "setup" || props.phase === "register" ? <p className="text-sm text-mute">口令至少 10 位。丢失口令无法找回，服务器也解不开数据。</p> : null}
      {props.phase === "unlock" && props.mode === "cloud" ? <p className="text-sm text-mute">{props.email} · 刷新后需要重新解锁</p> : null}
      {props.phase === "login" || props.phase === "register" ? (
        <input className="w-full rounded border border-line bg-ink px-3 py-3" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      ) : null}
      <input className="w-full rounded border border-line bg-ink px-3 py-3" placeholder="口令" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={props.phase === "login" || props.phase === "unlock" ? "current-password" : "new-password"} />
      {props.phase === "setup" || props.phase === "register" ? (
        <input className="w-full rounded border border-line bg-ink px-3 py-3" placeholder="再输入一次" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      ) : null}
      {password && confirm && password !== confirm ? <p className="text-sm text-danger">两次口令不一致</p> : null}
      {password && password.length < 10 && (props.phase === "setup" || props.phase === "register") ? <p className="text-sm text-danger">至少 10 位</p> : null}
      <button type="submit" disabled={props.busy || props.phase === "boot"} className="w-full rounded bg-lime px-3 py-3 font-medium text-ink">
        {props.busy ? "请稍候" : props.phase === "register" ? "注册并进入" : props.phase === "login" ? "登录" : props.phase === "setup" ? "创建本地保险库" : "解锁"}
      </button>
      {props.mode === "cloud" && props.phase === "login" ? <button type="button" className="text-sm text-lime" onClick={() => props.onWant("register")}>没有账号，注册</button> : null}
      {props.mode === "cloud" && props.phase === "register" ? <button type="button" className="text-sm text-lime" onClick={() => props.onWant("login")}>已有账号，登录</button> : null}
    </form>
  );
}

type ApiVar = {
  id: string;
  scopeType: ScopeType;
  serverId: string | null;
  projectId: string | null;
  key: string;
  valueCipher: string;
  valueIv: string;
  noteCipher: string | null;
  noteIv: string | null;
  type: VarType;
  createdAt: string;
  updatedAt: string;
};

type Bootstrap = {
  servers: ServerRecord[];
  projects: ProjectRecord[];
  links: LinkRecord[];
  variables: ApiVar[];
  versions: {
    id: string;
    variableId: string;
    valueCipher: string;
    valueIv: string;
    noteCipher: string | null;
    noteIv: string | null;
    type: VarType;
    actor: string;
    createdAt: string;
  }[];
  templates: StoredTemplate[];
};

function fromApiVar(row: ApiVar): StoredVar {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.serverId ?? row.projectId ?? null,
    key: row.key,
    type: row.type,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function fromApiVersion(row: Bootstrap["versions"][number]): StoredVersion {
  return row;
}

function toApiCipher(row: StoredVar) {
  return {
    scopeType: row.scopeType,
    serverId: row.scopeType === "server" ? row.scopeId : null,
    projectId: row.scopeType === "project" ? row.scopeId : null,
    key: row.key,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    type: row.type,
  };
}

function stripPlain(row: DecryptedVar): StoredVar {
  const { value: _value, note: _note, ...stored } = row;
  return stored;
}

function versionFrom(row: DecryptedVar, actor: string): StoredVersion {
  return {
    id: crypto.randomUUID(),
    variableId: row.id,
    valueCipher: row.valueCipher,
    valueIv: row.valueIv,
    noteCipher: row.noteCipher,
    noteIv: row.noteIv,
    type: row.type,
    actor,
    createdAt: new Date().toISOString(),
  };
}

function trimVersionList(rows: StoredVersion[], variableId: string): StoredVersion[] {
  const mine = rows.filter((row) => row.variableId === variableId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set(mine.slice(0, VERSION_KEEP).map((row) => row.id));
  return rows.filter((row) => row.variableId !== variableId || keep.has(row.id));
}

async function buildMeta(encKey: CryptoKey, dek: CryptoKey, raw: Uint8Array, salt: string): Promise<VaultMeta> {
  const wrapped = await wrapDek(encKey, raw);
  const canary = await sealCanary(dek);
  return {
    kdfSalt: salt,
    kdfMemory: PROD_KDF.memory,
    kdfIterations: PROD_KDF.iterations,
    kdfParallelism: PROD_KDF.parallelism,
    wrappedDek: wrapped.wrappedDek,
    dekIv: wrapped.dekIv,
    canaryCipher: canary.cipher,
    canaryIv: canary.iv,
  };
}

function accountToMeta(account: Account): VaultMeta {
  return {
    kdfSalt: account.kdfSalt,
    kdfMemory: account.kdfParams.memory,
    kdfIterations: account.kdfParams.iterations,
    kdfParallelism: account.kdfParams.parallelism,
    wrappedDek: account.wrappedDek,
    dekIv: account.dekIv,
    canaryCipher: "",
    canaryIv: "",
  };
}

async function sealTemplate(dek: CryptoKey, name: string, body: string): Promise<StoredTemplate> {
  const sealed = await import("../lib/crypto").then((mod) => mod.aesEncrypt(dek, body));
  return { id: crypto.randomUUID(), name, bodyCipher: sealed.cipher, bodyIv: sealed.iv, createdAt: new Date().toISOString() };
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message && err.message.length < 80 && !err.message.includes("cipher")) return err.message;
  return "操作失败";
}
