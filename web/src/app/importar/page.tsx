"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileUp,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  FolderOpen,
  Trash2,
} from "lucide-react";
import {
  detectFuente,
  FUENTES,
  FUENTES_GROUPS,
  fuenteLabel,
  uploadFile,
  runLoaders,
  fetchImportLog,
  formatBytes,
  type FileQueueItem,
  type FileStatus,
  type FuenteGroupItem,
  type ImportLogRow,
} from "@/lib/import-queries";

// Orden recomendado para correr loaders cuando hay varias fuentes:
// productos y segmentacion primero (establecen FKs), el resto después.
const LOADER_PRIORITY: Record<string, number> = {
  productos: 0,
  segmentacion: 1,
};
function sortByPriority(loaders: string[]): string[] {
  return [...loaders].sort(
    (a, b) => (LOADER_PRIORITY[a] ?? 99) - (LOADER_PRIORITY[b] ?? 99),
  );
}

// Cuánto tarda cada fase para que la UI muestre ETA razonable.
type BatchPhase =
  | { kind: "idle" }
  | { kind: "uploading"; total: number; done: number }
  | { kind: "processing"; total: number; done: number; current: string }
  | { kind: "refreshing" }
  | { kind: "complete"; elapsed: number };

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  FileStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  pendiente: { label: "Pendiente", icon: Clock, className: "text-gray-500" },
  guardando: { label: "Guardando…", icon: Loader2, className: "text-blue-500 animate-spin" },
  guardado: { label: "Guardado", icon: FolderOpen, className: "text-blue-600" },
  procesando: { label: "Procesando…", icon: Loader2, className: "text-amber-500 animate-spin" },
  procesado: { label: "Procesado", icon: CheckCircle2, className: "text-green-600" },
  error: { label: "Error", icon: XCircle, className: "text-red-500" },
};

function StatusBadge({ status, error }: { status: FileStatus; error?: string }) {
  const c = STATUS_CONFIG[status];
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title={error}>
      <Icon className={`h-4 w-4 ${c.className}`} />
      <span className={status === "error" ? "text-red-600" : ""}>{c.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Unique ID generator
// ---------------------------------------------------------------------------
let _id = 0;
function uid() {
  return `file-${++_id}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ImportarDatosPage() {
  const [queue, setQueue] = useState<FileQueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<ImportLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [phase, setPhase] = useState<BatchPhase>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Fuente pre-seleccionada por click en la tarjeta "Fuentes disponibles".
  // useRef (no state) porque addFiles tiene que leerla sincrónicamente desde
  // el callback de <input onChange>, antes de que React procese un setState.
  const preselectedFuenteRef = useRef<string | null>(null);

  // Load import history
  const loadHistory = useCallback(() => {
    fetchImportLog()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Add files to queue. Si hay fuente pre-seleccionada (click en una tarjeta),
  // la usamos en vez de la detección automática por nombre.
  const addFiles = useCallback((files: FileList | File[]) => {
    const forced = preselectedFuenteRef.current;
    const items: FileQueueItem[] = Array.from(files).map((file) => ({
      id: uid(),
      file,
      fuente: forced ?? detectFuente(file.name),
      status: "pendiente" as FileStatus,
    }));
    setQueue((prev) => [...prev, ...items]);
    preselectedFuenteRef.current = null;
  }, []);

  // Click en un item de "Fuentes disponibles": abrir file picker con la fuente
  // pre-seleccionada. Útil cuando el nombre del archivo no matchea el pattern.
  const handleSourceClick = useCallback((item: FuenteGroupItem) => {
    preselectedFuenteRef.current = item.loader;
    fileInputRef.current?.click();
  }, []);

  // Update a queue item
  const updateItem = useCallback(
    (id: string, patch: Partial<FileQueueItem>) => {
      setQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
      );
    },
    []
  );

  // Remove item from queue
  const removeItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Upload a single file (acción manual, sin procesar)
  const handleUpload = useCallback(
    async (item: FileQueueItem) => {
      if (!item.fuente) return;
      updateItem(item.id, { status: "guardando" });
      const result = await uploadFile(item.file, item.fuente);
      if (result.ok) {
        updateItem(item.id, { status: "guardado", logId: result.logId });
      } else {
        updateItem(item.id, { status: "error", error: result.error });
      }
      loadHistory();
    },
    [updateItem, loadHistory]
  );

  // Sube los items pendientes en paralelo. Devuelve map id → {fuente, logId?, ok}.
  const uploadPending = useCallback(
    async (items: FileQueueItem[]) => {
      const toUpload = items.filter((i) => i.status === "pendiente" && i.fuente);
      let done = 0;
      setPhase({ kind: "uploading", total: toUpload.length, done });

      const results = await Promise.all(
        toUpload.map(async (item) => {
          updateItem(item.id, { status: "guardando" });
          const r = await uploadFile(item.file, item.fuente!);
          done += 1;
          setPhase({ kind: "uploading", total: toUpload.length, done });
          if (r.ok) {
            updateItem(item.id, { status: "guardado", logId: r.logId });
            return { id: item.id, fuente: item.fuente!, logId: r.logId, ok: true };
          } else {
            updateItem(item.id, { status: "error", error: r.error });
            return { id: item.id, fuente: item.fuente!, logId: undefined, ok: false };
          }
        }),
      );
      return results;
    },
    [updateItem],
  );

  // Procesa: sube lo pendiente, agrupa por fuente, corre cada loader una sola
  // vez, refresca las MVs al final. Una sola llamada al endpoint bulk.
  const handleProcessAll = useCallback(async () => {
    const startedAt = Date.now();
    const candidates = queue.filter(
      (item) => item.fuente && (item.status === "pendiente" || item.status === "guardado"),
    );
    if (candidates.length === 0) return;

    // 1) Subir pendientes en paralelo.
    const uploaded = await uploadPending(candidates);
    const uploadedOk = uploaded.filter((u) => u.ok);

    // 2) Items listos para procesar: los recién subidos + los que ya estaban "guardado".
    const readyItems = queue.filter(
      (item) =>
        item.fuente &&
        (item.status === "guardado" ||
          uploadedOk.some((u) => u.id === item.id && u.fuente === item.fuente)),
    );

    // 3) Agrupar por fuente y obtener los logIds de cada fuente.
    const fuentesSet = new Set<string>();
    const logIdsByLoader: Record<string, number[]> = {};
    const itemsByFuente = new Map<string, string[]>(); // fuente → [itemId]

    for (const item of readyItems) {
      const f = item.fuente!;
      fuentesSet.add(f);
      if (item.logId != null) {
        (logIdsByLoader[f] ||= []).push(item.logId);
      }
      (itemsByFuente.get(f) ?? itemsByFuente.set(f, []).get(f)!).push(item.id);
    }

    if (fuentesSet.size === 0) {
      setPhase({ kind: "idle" });
      return;
    }

    const loaders = sortByPriority(
      Array.from(fuentesSet).map(
        (f) => FUENTES.find((x) => x.key === f)?.loader ?? f,
      ),
    );

    // 4) Marcar items como "procesando".
    for (const item of readyItems) {
      updateItem(item.id, { status: "procesando" });
    }

    // 5) Ejecutar loaders (el endpoint corre en orden y refresca MVs al final).
    setPhase({ kind: "processing", total: loaders.length, done: 0, current: loaders[0] });
    const response = await runLoaders(loaders, logIdsByLoader);

    // 6) Actualizar status por fuente en base a los resultados.
    for (const result of response.results) {
      const ids = itemsByFuente.get(result.loader) ?? [];
      // `registros` del loader es el total procesado para la fuente entera.
      for (const id of ids) {
        if (result.ok) {
          updateItem(id, {
            status: "procesado",
            registros: result.registros ?? undefined,
          });
        } else {
          updateItem(id, {
            status: "error",
            error: result.error ?? "Error ejecutando loader",
          });
        }
      }
    }

    // 7) Fase de refresh (si hubo refresh del endpoint, ya ocurrió servidor-side).
    if (response.refresh?.ok) {
      setPhase({ kind: "refreshing" });
      // Pequeña espera visual para que el usuario vea el mensaje.
      await new Promise((r) => setTimeout(r, 300));
    }

    setPhase({ kind: "complete", elapsed: Date.now() - startedAt });
    loadHistory();

    // Volver a idle tras 4s para que la UI quede limpia.
    setTimeout(() => setPhase({ kind: "idle" }), 4000);
  }, [queue, uploadPending, updateItem, loadHistory]);

  // Variante de un solo item: reusa handleProcessAll filtrando.
  const handleProcess = useCallback(
    async (target: FileQueueItem) => {
      if (!target.fuente) return;
      // Hack: filtrar temporalmente procesando solo los que tengan el mismo id.
      // La lógica de batch ya cubre 1 item, solo hay que asegurarse de que los
      // demás no sean candidatos — marcamos el resto como "no-elegibles"
      // temporalmente, pero más simple: clonamos queue, filtramos y llamamos.
      const originalQueue = queue;
      const singleItemQueue = queue.filter((x) => x.id === target.id);
      // Usamos una versión local sin modificar el estado global.
      // Dado que handleProcessAll usa el estado, hacemos el flujo inline.
      const startedAt = Date.now();

      // 1) Upload si es necesario
      if (target.status === "pendiente") {
        updateItem(target.id, { status: "guardando" });
        setPhase({ kind: "uploading", total: 1, done: 0 });
        const r = await uploadFile(target.file, target.fuente);
        setPhase({ kind: "uploading", total: 1, done: 1 });
        if (!r.ok) {
          updateItem(target.id, { status: "error", error: r.error });
          setPhase({ kind: "idle" });
          loadHistory();
          return;
        }
        updateItem(target.id, { status: "guardado", logId: r.logId });
        target = { ...target, status: "guardado", logId: r.logId };
      }

      // 2) Ejecutar loader
      const fuente = target.fuente;
      if (!fuente) return;
      const loader = FUENTES.find((f) => f.key === fuente)?.loader ?? fuente;
      updateItem(target.id, { status: "procesando" });
      setPhase({ kind: "processing", total: 1, done: 0, current: loader });
      const response = await runLoaders(
        [loader],
        target.logId ? { [loader]: [target.logId] } : undefined,
      );
      const r = response.results[0];

      if (r?.ok) {
        updateItem(target.id, {
          status: "procesado",
          registros: r.registros ?? undefined,
        });
      } else {
        updateItem(target.id, {
          status: "error",
          error: r?.error ?? "Error ejecutando loader",
        });
      }

      if (response.refresh?.ok) {
        setPhase({ kind: "refreshing" });
        await new Promise((r) => setTimeout(r, 300));
      }

      setPhase({ kind: "complete", elapsed: Date.now() - startedAt });
      loadHistory();
      setTimeout(() => setPhase({ kind: "idle" }), 4000);
      // Silencia "originalQueue / singleItemQueue" unused warnings
      void originalQueue;
      void singleItemQueue;
    },
    [queue, updateItem, loadHistory],
  );

  // Auto-limpiar items "procesado" exitosos tras 5s (dejar errores visibles).
  useEffect(() => {
    const processedIds = queue
      .filter((item) => item.status === "procesado")
      .map((item) => item.id);
    if (processedIds.length === 0) return;
    const timer = setTimeout(() => {
      setQueue((prev) => prev.filter((item) => !processedIds.includes(item.id)));
    }, 5000);
    return () => clearTimeout(timer);
  }, [queue]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles]
  );

  const hasPending = queue.some(
    (item) => item.fuente && (item.status === "pendiente" || item.status === "guardado")
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Importar Datos</h1>
        <p className="text-muted-foreground">
          Subir archivos CSV/XLSX para procesar con el ETL
        </p>
      </div>

      {/* Dev-only warning */}
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Solo disponible en desarrollo local. Los archivos se guardan en{" "}
          <code className="rounded bg-amber-100 px-1 text-xs">data_raw/</code> y
          se procesan con Python.
        </span>
      </div>

      {/* Phase banner */}
      <PhaseBanner phase={phase} />

      {/* Drop zone */}
      <div
        className={`relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-8 transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload
          className={`h-12 w-12 ${dragging ? "text-blue-500" : "text-muted-foreground/50"}`}
        />
        <div className="text-center">
          <p className="text-lg font-medium">
            {dragging ? "Soltar archivos aquí" : "Arrastrá archivos o hacé click para seleccionar"}
          </p>
          <p className="text-sm text-muted-foreground">
            Formatos: .csv, .xlsx, .xls, .txt — Se detecta la fuente automáticamente
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.txt,.zip,.pdf"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Fuentes disponibles (referencia + click para abrir picker con fuente forzada) */}
      <FuentesDisponibles onSourceClick={handleSourceClick} />

      {/* File queue */}
      {queue.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Cola de archivos ({queue.length})
            </CardTitle>
            {hasPending && (
              <button
                onClick={handleProcessAll}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                Procesar todos
              </button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Tamaño</TableHead>
                  <TableHead>Fuente detectada</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[250px] truncate font-mono text-sm">
                      <div className="flex items-center gap-2">
                        <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {item.file.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatBytes(item.file.size)}
                    </TableCell>
                    <TableCell>
                      {item.fuente ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {fuenteLabel(item.fuente)}
                        </span>
                      ) : (
                        <select
                          className="rounded border bg-background px-2 py-1 text-xs"
                          value=""
                          onChange={(e) =>
                            updateItem(item.id, { fuente: e.target.value || null })
                          }
                        >
                          <option value="">Seleccionar fuente…</option>
                          {FUENTES.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} error={item.error} />
                      {item.registros != null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({item.registros.toLocaleString("es-AR")} reg.)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {item.status === "pendiente" && item.fuente && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpload(item);
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Guardar archivo"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleProcess(item);
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Guardar y procesar"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {item.status === "guardado" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProcess(item);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Procesar con ETL"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                        )}
                        {(item.status === "pendiente" ||
                          item.status === "guardado" ||
                          item.status === "error" ||
                          item.status === "procesado") && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeItem(item.id);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-500"
                            title="Quitar de la cola"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Import history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de importaciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No hay importaciones registradas
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Fuente</TableHead>
                  <TableHead>Tamaño</TableHead>
                  <TableHead className="text-right">Registros</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[200px] truncate font-mono text-sm">
                      {row.archivo}
                    </TableCell>
                    <TableCell className="text-sm">
                      {fuenteLabel(row.fuente)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.tamano_bytes ? formatBytes(row.tamano_bytes) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.registros_procesados != null
                        ? row.registros_procesados.toLocaleString("es-AR")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <HistoryStatus estado={row.estado} error={row.error_mensaje} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase banner — muestra progreso en vivo durante el batch de import + ETL.
// ---------------------------------------------------------------------------

function PhaseBanner({ phase }: { phase: BatchPhase }) {
  if (phase.kind === "idle") return null;

  let icon: React.ElementType = Loader2;
  let className = "animate-spin text-blue-600";
  let label = "";
  let pct: number | null = null;

  if (phase.kind === "uploading") {
    label = `Subiendo archivos (${phase.done}/${phase.total})`;
    pct = phase.total > 0 ? (phase.done / phase.total) * 100 : 0;
  } else if (phase.kind === "processing") {
    label = `Ejecutando ETL — ${phase.current}`;
  } else if (phase.kind === "refreshing") {
    label = "Refrescando materialized views (puede tardar ~25s)";
    className = "animate-spin text-amber-600";
  } else if (phase.kind === "complete") {
    icon = CheckCircle2;
    className = "text-green-600";
    label = `Listo en ${(phase.elapsed / 1000).toFixed(1)}s — datos actualizados`;
  }

  const Icon = icon;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 shrink-0 ${className}`} />
        <div className="flex-1 text-sm font-medium">{label}</div>
      </div>
      {pct != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-blue-500 transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fuentes disponibles — grilla con los 6 grupos y sus items clickeables
// ---------------------------------------------------------------------------

function FuentesDisponibles({
  onSourceClick,
}: {
  onSourceClick: (item: FuenteGroupItem) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fuentes disponibles</CardTitle>
        <p className="text-sm text-muted-foreground">
          Hacé click en una fuente para abrir el selector con esa fuente
          forzada (útil si el nombre del archivo no la detecta automáticamente).
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FUENTES_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.loader}
                    type="button"
                    onClick={() => onSourceClick(item)}
                    className="group flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted/50"
                  >
                    <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {item.label}
                        </span>
                        <div className="flex gap-1">
                          {item.formats.map((fmt) => (
                            <span
                              key={fmt}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground"
                            >
                              {fmt}
                            </span>
                          ))}
                        </div>
                      </div>
                      {item.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History status badge
// ---------------------------------------------------------------------------

function HistoryStatus({ estado, error }: { estado: string; error: string | null }) {
  const config: Record<string, { icon: React.ElementType; className: string; bg: string }> = {
    pendiente: { icon: Clock, className: "text-gray-600", bg: "bg-gray-50" },
    guardado: { icon: FolderOpen, className: "text-blue-600", bg: "bg-blue-50" },
    procesando: { icon: Loader2, className: "text-amber-600 animate-spin", bg: "bg-amber-50" },
    procesado: { icon: CheckCircle2, className: "text-green-600", bg: "bg-green-50" },
    error: { icon: XCircle, className: "text-red-600", bg: "bg-red-50" },
  };
  const c = config[estado] ?? config.pendiente;
  const Icon = c.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.className}`}
      title={error ?? undefined}
    >
      <Icon className="h-3 w-3" />
      {estado.charAt(0).toUpperCase() + estado.slice(1)}
    </span>
  );
}
