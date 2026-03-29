"use client";

import Link from "next/link";

// ---------------------------------------------------------------------------
// Org chart data — hardcoded (structure doesn't change frequently)
// ---------------------------------------------------------------------------

interface OrgNode {
  label: string;
  nickname?: string;
  color: string; // border color class
  bgColor: string; // background color class
  external?: boolean; // not on payroll
  category?: boolean; // generic role, no specific person
  children?: OrgNode[];
}

const ORG_TREE: OrgNode = {
  label: "CONFITERÍA SAN LUIS",
  color: "border-gray-400",
  bgColor: "bg-white",
  children: [
    {
      label: "ANDREA Y FABIAN",
      nickname: "Dirección",
      color: "border-gray-400",
      bgColor: "bg-white",
      children: [
        {
          label: "PRODUCCIÓN",
          color: "border-gray-400",
          bgColor: "bg-white",
          children: [
            {
              label: "PASTELERÍA",
              color: "border-yellow-400",
              bgColor: "bg-yellow-50",
              children: [
                { label: "Petoyan Marcela", nickname: "MARCELA", color: "border-yellow-300", bgColor: "bg-yellow-50/60" },
                { label: "Travaglia Romina Paola", nickname: "ROMINA", color: "border-yellow-300", bgColor: "bg-yellow-50/60" },
              ],
            },
            {
              label: "COCINA",
              color: "border-blue-400",
              bgColor: "bg-blue-50",
              children: [
                { label: "Rivero Velazco Edinson", nickname: "EDDIE", color: "border-blue-300", bgColor: "bg-blue-50/60" },
                { label: "Miño Anibal Hugo", nickname: "HUGO", color: "border-blue-300", bgColor: "bg-blue-50/60" },
                { label: "Lupano Federico", nickname: "FEDERICO", color: "border-blue-300", bgColor: "bg-blue-50/60" },
              ],
            },
            {
              label: "MOSTRADOR",
              color: "border-red-400",
              bgColor: "bg-red-50",
              children: [
                { label: "De Luca Pablo Esteban", nickname: "PABLO", color: "border-red-300", bgColor: "bg-red-50/60" },
                { label: "Alvarez Estela Maria", nickname: "VERONICA", color: "border-red-300", bgColor: "bg-red-50/60" },
                { label: "Altuna Valeria Renata", nickname: "VALERIA", color: "border-red-300", bgColor: "bg-red-50/60" },
                { label: "Travaglia Maria Belen", nickname: "BELEN", color: "border-red-300", bgColor: "bg-red-50/60" },
                { label: "Lopez Edith Catalina", nickname: "CATALINA", color: "border-red-300", bgColor: "bg-red-50/60" },
              ],
            },
            {
              label: "TERRAZA",
              color: "border-purple-400",
              bgColor: "bg-purple-50",
              children: [
                { label: "Gaudio Cabrera Daniel", nickname: "PICHI", color: "border-purple-300", bgColor: "bg-purple-50/60" },
                { label: "Gomez Julieta Natalia", nickname: "JULIETA", color: "border-purple-300", bgColor: "bg-purple-50/60" },
                { label: "Posterivo Mauro Ezequi", nickname: "MAURO", color: "border-purple-300", bgColor: "bg-purple-50/60" },
                { label: "Franco", external: true, color: "border-purple-300", bgColor: "bg-purple-50/60" },
              ],
            },
            {
              label: "REPARTIDOR",
              color: "border-green-400",
              bgColor: "bg-green-50",
              children: [
                { label: "Genua Marcelo Emanuel", nickname: "CHINO", color: "border-green-300", bgColor: "bg-green-50/60" },
              ],
            },
            {
              label: "ORDEN Y LIMPIEZA",
              color: "border-teal-400",
              bgColor: "bg-teal-50",
              children: [
                { label: "Montaña Alexander Daniel", nickname: "ALEX", color: "border-teal-300", bgColor: "bg-teal-50/60" },
              ],
            },
            {
              label: "PERSONAL EXTRA",
              color: "border-amber-400",
              bgColor: "bg-amber-50",
              children: [
                { label: "Mozos", category: true, color: "border-amber-300", bgColor: "bg-amber-50/60" },
              ],
            },
          ],
        },
        {
          label: "SERVICIOS TERCERIZADOS",
          color: "border-gray-400",
          bgColor: "bg-gray-100",
          children: [
            { label: "Contabilidad", category: true, color: "border-gray-300", bgColor: "bg-gray-50" },
            { label: "Finanzas", category: true, color: "border-gray-300", bgColor: "bg-gray-50" },
            { label: "Marketing", category: true, color: "border-gray-300", bgColor: "bg-gray-50" },
            { label: "Sistemas", category: true, color: "border-gray-300", bgColor: "bg-gray-50" },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Desktop: horizontal tree with SVG connector lines
// ---------------------------------------------------------------------------

function NodeBox({ node }: { node: OrgNode }) {
  return (
    <div
      className={`rounded-md border-2 px-3 py-1.5 text-sm leading-tight ${node.color} ${node.bgColor} whitespace-nowrap`}
    >
      <span className="font-medium">
        {node.nickname && !node.category ? node.nickname : node.label}
      </span>
      {node.nickname && !node.category && (
        <span className="ml-1 text-xs text-muted-foreground">
          ({node.label.split(" ")[0]})
        </span>
      )}
      {node.external && (
        <span className="ml-1 rounded bg-gray-200 px-1 text-[10px] text-gray-600">ext</span>
      )}
      {node.category && !node.children && (
        <span className="ml-1 text-xs text-muted-foreground italic">servicio</span>
      )}
    </div>
  );
}

/** A vertical column: sector header + its employees stacked below */
function SectorColumn({ node }: { node: OrgNode }) {
  return (
    <div className="flex flex-col items-center gap-0">
      <NodeBox node={node} />
      {node.children && node.children.length > 0 && (
        <>
          {/* vertical line down from sector */}
          <div className={`w-px h-3 ${node.color.replace("border-", "bg-")}`} />
          <div className="flex flex-col items-center gap-0">
            {node.children.map((child, i) => (
              <div key={i} className="flex flex-col items-center">
                {i > 0 && <div className={`w-px h-2 ${node.color.replace("border-", "bg-")}`} />}
                <NodeBox node={child} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DesktopTree() {
  const root = ORG_TREE;
  const direccion = root.children![0]; // ANDREA Y FABIAN
  const produccion = direccion.children![0]; // PRODUCCIÓN
  const servicios = direccion.children![1]; // SERVICIOS TERCERIZADOS

  return (
    <div className="hidden lg:block overflow-x-auto">
      <div className="flex flex-col items-center gap-0 min-w-[1200px] py-8 px-4">
        {/* Root: CONFITERÍA SAN LUIS */}
        <NodeBox node={root} />
        <div className="w-px h-4 bg-gray-400" />

        {/* Dirección */}
        <NodeBox node={direccion} />
        <div className="w-px h-4 bg-gray-400" />

        {/* Horizontal bar connecting PRODUCCIÓN and SERVICIOS */}
        <div className="relative w-full">
          {/* The horizontal connector line */}
          <div className="absolute left-1/2 -translate-x-1/2 w-[85%] flex items-start">
            <div className="flex-1" />
            {/* Left end (PRODUCCIÓN) */}
            <div className="flex flex-col items-center">
              <div className="w-px h-4 bg-gray-400" />
            </div>
            <div className="flex-1 border-t-2 border-gray-300 mt-0" />
            {/* Right end (SERVICIOS) */}
            <div className="flex flex-col items-center">
              <div className="w-px h-4 bg-gray-400" />
            </div>
            <div className="flex-1" />
          </div>
        </div>

        {/* Two main branches side by side */}
        <div className="flex justify-center gap-16 mt-0 w-full">
          {/* PRODUCCIÓN branch */}
          <div className="flex flex-col items-center gap-0">
            <NodeBox node={produccion} />
            <div className="w-px h-4 bg-gray-400" />

            {/* Horizontal bar connecting all sectors */}
            <div className="relative">
              <div className="border-t-2 border-gray-300" style={{ width: `${(produccion.children!.length - 1) * 155 + 2}px` }} />
              {/* Vertical taps from the bar */}
              <div className="flex justify-between" style={{ width: `${(produccion.children!.length - 1) * 155 + 2}px` }}>
                {produccion.children!.map((_, i) => (
                  <div key={i} className="w-px h-4 bg-gray-300" />
                ))}
              </div>
            </div>

            {/* Sector columns */}
            <div className="flex gap-4 items-start">
              {produccion.children!.map((sector, i) => (
                <SectorColumn key={i} node={sector} />
              ))}
            </div>
          </div>

          {/* SERVICIOS TERCERIZADOS branch */}
          <div className="flex flex-col items-center gap-0">
            <NodeBox node={servicios} />
            {servicios.children && (
              <>
                <div className="w-px h-3 bg-gray-400" />
                <div className="flex flex-col items-center gap-0">
                  {servicios.children.map((child, i) => (
                    <div key={i} className="flex flex-col items-center">
                      {i > 0 && <div className="w-px h-2 bg-gray-300" />}
                      <NodeBox node={child} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile: hierarchical indented list
// ---------------------------------------------------------------------------

function MobileNode({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  const ml = depth * 16;
  return (
    <div>
      <div
        className={`rounded-md border-2 px-3 py-2 text-sm ${node.color} ${node.bgColor} mb-1`}
        style={{ marginLeft: ml }}
      >
        <span className="font-medium">{node.label}</span>
        {node.nickname && !node.category && (
          <span className="ml-1.5 text-xs text-muted-foreground">({node.nickname})</span>
        )}
        {node.external && (
          <span className="ml-1.5 rounded bg-gray-200 px-1 text-[10px] text-gray-600">externo</span>
        )}
        {node.category && !node.children && (
          <span className="ml-1.5 text-xs text-muted-foreground italic">servicio</span>
        )}
      </div>
      {node.children?.map((child, i) => (
        <MobileNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OrganigramaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Organigrama</h1>
        <p className="text-muted-foreground">
          Estructura organizacional — Confitería San Luis
        </p>
      </div>

      {/* Desktop: horizontal tree */}
      <DesktopTree />

      {/* Mobile: indented list */}
      <div className="lg:hidden space-y-0">
        <MobileNode node={ORG_TREE} />
      </div>
    </div>
  );
}
