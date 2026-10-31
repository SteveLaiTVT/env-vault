"use client";

import { useMemo, useState } from "react";
import { ACTION_LABEL } from "../lib/labels";
import type { AuditItem, LinkRecord, ProjectRecord, ServerRecord, StoredTemplate } from "../lib/model";

export type TokenListItem = {
  id: string;
  name: string;
  scopeType: string;
  serverId: string | null;
  projectId: string | null;
  canInject: boolean;
  canReplace: boolean;
  expiresAt: string;
  revokedAt: string | null;
};

type Props = {
  open: boolean;
  mode: "local" | "cloud";
  email: string | null;
  cloudAvailable: boolean;
  servers: ServerRecord[];
  projects: ProjectRecord[];
  links: LinkRecord[];
  tokens: TokenListItem[];
  audits: AuditItem[];
  templates: { id: string; name: string }[];
  onClose: () => void;
  onMode: (mode: "local" | "cloud") => void;
  onLock: () => void;
  onLogout: () => void;
  onCreateServer: (name: string, note: string) => Promise<void>;
  onDeleteServer: (id: string) => Promise<void>;
  onCreateProject: (name: string, note: string, serverIds: string[]) => Promise<void>;
  onUpdateProject: (id: string, serverIds: string[]) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onCreateToken: (input: {
    name: string;
    scopeType: "public" | "server" | "project";
    scopeId: string | null;
    canInject: boolean;
    canReplace: boolean;
    expiresAt: string;
  }) => Promise<string>;
  onRevokeToken: (id: string) => Promise<void>;
  onExport: () => void;
  onImportFile: (file: File, passphrase: string) => Promise<void>;
  onMigrate: (passphrase: string) => Promise<string>;
  onDeleteTemplate: (id: string) => Promise<void>;
};

export function SettingsDrawer(props: Props) {
  const [tab, setTab] = useState<"账户" | "作用域" | "令牌" | "审计" | "备份" | "模板">("账户");
  const [tokenOnce, setTokenOnce] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={props.onClose}>
      <aside
        className="h-full w-full overflow-y-auto border-l border-line bg-panel p-4 sm:max-w-md"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="设置"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">设置</h2>
          <button type="button" className="rounded border border-line px-3 py-2" onClick={props.onClose}>关闭</button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["账户", "作用域", "令牌", "审计", "备份", "模板"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded px-3 py-2 ${tab === item ? "bg-lime text-ink" : "border border-line"}`}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {message ? <p className="mb-3 text-sm text-lime">{message}</p> : null}
        {tab === "账户" ? (
          <div className="space-y-3 text-sm">
            <p>当前模式：{props.mode === "local" ? "本地" : "云端"}{props.email ? ` · ${props.email}` : ""}</p>
            <p className="text-mute">切换模式会锁定当前库。本地数据不会自动上传。</p>
            <div className="flex gap-2">
              <button type="button" className="rounded bg-lime px-3 py-2 text-ink" onClick={() => props.onMode("local")}>本地模式</button>
              <button type="button" className="rounded border border-line px-3 py-2" onClick={() => props.onMode("cloud")}>云端模式</button>
            </div>
            {!props.cloudAvailable ? <p className="text-danger">未配置 DATABASE_URL，云端不可用。</p> : null}
            <div className="flex gap-2">
              <button type="button" className="rounded border border-line px-3 py-2" onClick={props.onLock}>锁定</button>
              {props.mode === "cloud" ? <button type="button" className="rounded border border-line px-3 py-2" onClick={props.onLogout}>退出登录</button> : null}
            </div>
          </div>
        ) : null}
        {tab === "作用域" ? (
          <ScopeEditor
            servers={props.servers}
            projects={props.projects}
            links={props.links}
            onCreateServer={props.onCreateServer}
            onDeleteServer={props.onDeleteServer}
            onCreateProject={props.onCreateProject}
            onUpdateProject={props.onUpdateProject}
            onDeleteProject={props.onDeleteProject}
            onMessage={setMessage}
          />
        ) : null}
        {tab === "令牌" ? (
          props.mode === "local" ? <p className="text-sm text-mute">机器令牌只在云端模式签发。本地模式不连接 CLI。</p> : (
            <TokenEditor
              servers={props.servers}
              projects={props.projects}
              tokens={props.tokens}
              tokenOnce={tokenOnce}
              onCreate={async (input) => {
                const token = await props.onCreateToken(input);
                setTokenOnce(token);
              }}
              onRevoke={props.onRevokeToken}
              onClear={() => setTokenOnce(null)}
            />
          )
        ) : null}
        {tab === "审计" ? (
          <ul className="space-y-2 text-sm">
            {props.audits.length === 0 ? <li className="text-mute">暂无审计</li> : null}
            {props.audits.map((item) => (
              <li key={item.id} className="rounded border border-line p-2 font-mono text-xs">
                <div>{new Date(item.createdAt).toLocaleString("zh-CN")} · {ACTION_LABEL[item.action] ?? item.action} · {item.result === "ok" ? "成功" : "失败"}</div>
                <div className="text-mute">{item.scopeName || item.scopeType || "—"} {item.keyName || ""}</div>
              </li>
            ))}
          </ul>
        ) : null}
        {tab === "备份" ? (
          <BackupPanel
            mode={props.mode}
            onExport={props.onExport}
            onImportFile={props.onImportFile}
            onMigrate={props.onMigrate}
            onMessage={setMessage}
          />
        ) : null}
        {tab === "模板" ? (
          <ul className="space-y-2 text-sm">
            {props.templates.length === 0 ? <li className="text-mute">还没有保存的模板。在输出区生成后可保存。</li> : null}
            {props.templates.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded border border-line p-2">
                <span>{item.name}</span>
                <button type="button" className="text-danger" onClick={() => props.onDeleteTemplate(item.id)}>删除</button>
              </li>
            ))}
          </ul>
        ) : null}
      </aside>
    </div>
  );
}

function ScopeEditor(props: {
  servers: ServerRecord[];
  projects: ProjectRecord[];
  links: LinkRecord[];
  onCreateServer: Props["onCreateServer"];
  onDeleteServer: Props["onDeleteServer"];
  onCreateProject: Props["onCreateProject"];
  onUpdateProject: Props["onUpdateProject"];
  onDeleteProject: Props["onDeleteProject"];
  onMessage: (value: string) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const ordered = useMemo(() => props.links, [props.links]);
  return (
    <div className="space-y-4 text-sm">
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          await props.onCreateServer(name, note);
          setName("");
          setNote("");
          props.onMessage("已添加服务器");
        }}
      >
        <h3 className="font-medium">服务器</h3>
        <input className="w-full rounded border border-line bg-ink px-3 py-2" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full rounded border border-line bg-ink px-3 py-2" placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="rounded bg-lime px-3 py-2 text-ink">添加服务器</button>
      </form>
      <ul className="space-y-1">
        {props.servers.map((server) => (
          <li key={server.id} className="flex justify-between gap-2">
            <span>{server.name}</span>
            <button type="button" className="text-danger" onClick={() => props.onDeleteServer(server.id)}>删除</button>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          await props.onCreateProject(name, note, picked);
          setPicked([]);
          props.onMessage("已添加项目");
        }}
      >
        <h3 className="font-medium">项目</h3>
        <p className="text-mute">关联服务器时，列表靠后者覆盖靠前者。</p>
        {props.servers.map((server) => (
          <label key={server.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={picked.includes(server.id)}
              onChange={(event) => {
                setPicked((current) => event.target.checked ? [...current, server.id] : current.filter((id) => id !== server.id));
              }}
            />
            {server.name}
          </label>
        ))}
        <button type="submit" className="rounded bg-lime px-3 py-2 text-ink">添加项目</button>
      </form>
      <ul className="space-y-2">
        {props.projects.map((project) => {
          const ids = ordered.filter((link) => link.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.serverId);
          return (
            <li key={project.id} className="rounded border border-line p-2">
              <div className="flex justify-between">
                <span>{project.name}</span>
                <button type="button" className="text-danger" onClick={() => props.onDeleteProject(project.id)}>删除</button>
              </div>
              <ProjectOrder
                ids={ids}
                servers={props.servers}
                onChange={(next) => props.onUpdateProject(project.id, next)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProjectOrder(props: { ids: string[]; servers: ServerRecord[]; onChange: (ids: string[]) => Promise<void> }) {
  function move(index: number, dir: -1 | 1) {
    const next = [...props.ids];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    void props.onChange(next);
  }
  return (
    <ul className="mt-2 space-y-1">
      {props.ids.map((id, index) => (
        <li key={id} className="flex items-center justify-between gap-2 text-mute">
          <span>{props.servers.find((server) => server.id === id)?.name ?? id}</span>
          <span className="space-x-2">
            <button type="button" onClick={() => move(index, -1)}>上移</button>
            <button type="button" onClick={() => move(index, 1)}>下移</button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function TokenEditor(props: {
  servers: ServerRecord[];
  projects: ProjectRecord[];
  tokens: TokenListItem[];
  tokenOnce: string | null;
  onCreate: (input: {
    name: string;
    scopeType: "public" | "server" | "project";
    scopeId: string | null;
    canInject: boolean;
    canReplace: boolean;
    expiresAt: string;
  }) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onClear: () => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("public");
  const [inject, setInject] = useState(true);
  const [replace, setReplace] = useState(false);
  const [days, setDays] = useState(30);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-mute">私钥只显示一次。服务端只存哈希和公钥，解不开变量。</p>
      {props.tokenOnce ? (
        <div className="space-y-2 rounded border border-lime p-3">
          <p>请立即复制。关闭后无法再查看。</p>
          <textarea readOnly className="h-28 w-full rounded bg-ink p-2 font-mono text-xs" value={props.tokenOnce} />
          <button
            type="button"
            className="rounded bg-lime px-3 py-2 text-ink"
            onClick={async () => {
              await navigator.clipboard.writeText(props.tokenOnce ?? "");
            }}
          >
            复制令牌
          </button>
          <button type="button" className="ml-2 rounded border border-line px-3 py-2" onClick={props.onClear}>我已保存</button>
        </div>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const scopeType = scope === "public" ? "public" : scope.startsWith("server:") ? "server" : "project";
          const scopeId = scopeType === "public" ? null : scope.split(":")[1] ?? null;
          const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          await props.onCreate({ name, scopeType, scopeId, canInject: inject, canReplace: replace, expiresAt });
          setName("");
        }}
      >
        <input className="w-full rounded border border-line bg-ink px-3 py-2" placeholder="令牌名称" value={name} onChange={(e) => setName(e.target.value)} required />
        <select className="w-full rounded border border-line bg-ink px-3 py-2" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="public">公共层</option>
          {props.servers.map((server) => <option key={server.id} value={`server:${server.id}`}>服务器 · {server.name}</option>)}
          {props.projects.map((project) => <option key={project.id} value={`project:${project.id}`}>项目 · {project.name}</option>)}
        </select>
        <label className="flex gap-2"><input type="checkbox" checked={inject} onChange={(e) => setInject(e.target.checked)} />注入</label>
        <label className="flex gap-2"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />替换</label>
        <label className="block">有效天数（最长 90）
          <input type="number" min={1} max={90} className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
        <button type="submit" className="rounded bg-lime px-3 py-2 text-ink">签发令牌</button>
      </form>
      <ul className="space-y-2">
        {props.tokens.map((token) => (
          <li key={token.id} className="rounded border border-line p-2">
            <div>{token.name} {token.revokedAt ? "· 已吊销" : ""}</div>
            <div className="text-mute">{token.canInject ? "注入" : ""} {token.canReplace ? "替换" : ""} · {new Date(token.expiresAt).toLocaleDateString("zh-CN")}</div>
            {!token.revokedAt ? <button type="button" className="text-danger" onClick={() => props.onRevoke(token.id)}>吊销</button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BackupPanel(props: {
  mode: "local" | "cloud";
  onExport: () => void;
  onImportFile: (file: File, passphrase: string) => Promise<void>;
  onMigrate: (passphrase: string) => Promise<string>;
  onMessage: (value: string) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [backupPass, setBackupPass] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <button type="button" className="rounded bg-lime px-3 py-2 text-ink" onClick={props.onExport}>导出加密备份</button>
      <label className="block">导入备份
        <input type="file" accept="application/json" className="mt-1 block w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <input type="password" className="w-full rounded border border-line bg-ink px-3 py-2" placeholder="备份口令" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} />
      <button
        type="button"
        className="rounded border border-line px-3 py-2"
        onClick={async () => {
          if (!file) return;
          await props.onImportFile(file, backupPass);
          props.onMessage("备份已导入");
        }}
      >
        确认导入（同名 key 覆盖）
      </button>
      {props.mode === "cloud" ? (
        <form
          className="space-y-2 border-t border-line pt-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const summary = await props.onMigrate(passphrase);
            props.onMessage(summary);
          }}
        >
          <h3 className="font-medium">把本地库迁到云端</h3>
          <p className="text-mute">按名称匹配。同名 key 以本地覆盖云端。确认前只显示数量。</p>
          <input type="password" className="w-full rounded border border-line bg-ink px-3 py-2" placeholder="本地保险库口令" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          <button type="submit" className="rounded bg-lime px-3 py-2 text-ink">迁移到云端</button>
        </form>
      ) : null}
    </div>
  );
}
