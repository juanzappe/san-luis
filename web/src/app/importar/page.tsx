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
  fuenteLabel,
  uploadFile,
  runLoader,
  fetchImportLog,
  formatBytes,
  type FileQueueItem,
  type FileStatus,
  type ImportLogRow,
} from "@/lib/import-queries";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Add files to queue
  const addFiles = useCallback((files: FileList | File[]) => {
    const items: FileQueueItem[] = Array.from(files).map((file) => ({
      id: uid(),
      file,
      fuente: detectFuente(file.name),
      status: "pendiente" as FileStatus,
    }));
    setQueue((prev) => [...prev, ...items]);
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

  // Upload a single file
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

  // Process (run ETL loader) for a single file
  const handleProcess = useCallback(
    async (item: FileQueueItem) => {
      if (!item.fuente) return;
      const loader = FUENTES.find((f) => f.key === item.fuente)?.loader ?? item.fuente;

      // Upload first if still pending
      if (item.status === "pendiente") {
        updateItem(item.id, { status: "guardando" });
        const uploadResult = await uploadFile(item.file, item.fuente);
        if (!uploadResult.ok) {
          updateItem(item.id, { status: "error", error: uploadResult.error });
          return;
        }
        updateItem(item.id, { status: "guardado", logId: uploadResult.logId });
        item = { ...item, status: "guardado", logId: uploadResult.logId };
      }

      updateItem(item.id, { status: "procesando" });
      const result = await runLoader(loader, item.logId);
      if (result.ok) {
        updateItem(item.id, { status: "procesado", registros: result.registros });
      } else {
        updateItem(item.id, { status: "error", error: result.error });
      }
      loadHistory();
    },
    [updateItem, loadHistory]
  );

  // Bulk: upload & process all pending
  const handleProcessAll = useCallback(async () => {
    const pending = queue.filter(
      (item) => item.fuente && (item.status === "pendiente" || item.status === "guardado")
    );
    for (const item of pending) {
      await handleProcess(item);
    }
  }, [queue, handleProcess]);

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
          accept=".csv,.xlsx,.xls,.txt"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

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
