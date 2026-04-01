import { Store, UtensilsCrossed, Truck, Cake, Star } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATOS_SOCIETARIOS: [string, string][] = [
  ["Razón Social", "Nadal y Zaccaro S.A."],
  ["Nombre de Fantasía", "Confitería San Luis"],
  ["CUIT", "30-65703377-0"],
  ["Tipo Societario", "Sociedad Anónima"],
  ["Actividad Principal", "Elaboración y venta de productos de confitería, panadería y catering"],
  ["Condición ante IVA", "Responsable Inscripto"],
  ["Domicilio Legal", "Calle 7 Nro. 1500, La Plata, Buenos Aires"],
  ["Fecha de Constitución", "1989"],
];

const UNIDADES = [
  {
    nombre: "Mostrador",
    icon: Store,
    descripcion:
      "Venta minorista de productos de confitería y panadería. Punto de venta principal con facturación fiscal (PV 8).",
  },
  {
    nombre: "Restobar / La Terraza",
    icon: UtensilsCrossed,
    descripcion:
      "Servicio gastronómico en salón y terraza. Menú de platos, bebidas y cafetería.",
  },
  {
    nombre: "Servicios / Catering",
    icon: Truck,
    descripcion:
      "Servicio de catering para eventos, empresas y organismos públicos. Facturación por ARCA (PV 6). Principal cliente: Gobierno de la Provincia de Buenos Aires.",
  },
  {
    nombre: "Decoración",
    icon: Cake,
    descripcion:
      "Diseño y elaboración de tortas decoradas, mesas dulces y productos personalizados para eventos.",
  },
] as const;

const INFO_FISCAL: [string, string][] = [
  ["Régimen IIBB", "Convenio Multilateral"],
  ["Jurisdicción Principal", "Buenos Aires (902)"],
  ["Puntos de Venta", "PV 6 (Servicios/Catering), PV 8 (Mostrador)"],
  ["Cierre de Ejercicio", "31 de Diciembre"],
  ["Banco Principal", "Banco Provincia de Buenos Aires"],
  ["Billetera Virtual", "Mercado Pago"],
  ["Sistema POS", "Posberry"],
  ["Contador", "—"],
];

const ACTIVIDADES_ARCA: { codigo: string; actividad: string; alta: string; principal?: boolean }[] = [
  { codigo: "107309", actividad: "Elaboración de productos de confitería", alta: "11/2013", principal: true },
  { codigo: "472172", actividad: "Venta al por menor de bombones, golosinas y confitería", alta: "11/2013" },
  { codigo: "562010", actividad: "Preparación de comidas para empresas y eventos", alta: "09/2015" },
  { codigo: "772099", actividad: "Alquiler de efectos personales y enseres domésticos", alta: "09/2016" },
  { codigo: "551022", actividad: "Alojamiento en hoteles con servicio de restaurante", alta: "07/2017" },
  { codigo: "900030", actividad: "Servicios conexos a espectáculos", alta: "12/2018" },
  { codigo: "472200", actividad: "Venta al por menor de bebidas", alta: "12/2019" },
  { codigo: "107129", actividad: "Elaboración de productos de panadería", alta: "12/2019" },
  { codigo: "854990", actividad: "Servicios de enseñanza n.c.p.", alta: "12/2021" },
  { codigo: "960990", actividad: "Servicios personales n.c.p.", alta: "01/2022" },
  { codigo: "475440", actividad: "Venta al por menor de artículos de bazar y menaje", alta: "01/2022" },
  { codigo: "109000", actividad: "Servicios industriales para elaboración de alimentos", alta: "01/2023" },
  { codigo: "472171", actividad: "Venta al por menor de pan y productos de panadería", alta: "01/2023" },
  { codigo: "772010", actividad: "Alquiler de videos y videojuegos", alta: "01/2023" },
  { codigo: "772091", actividad: "Alquiler de prendas de vestir", alta: "01/2023" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DatosdelNegocioPage() {
  const antiguedad = new Date().getFullYear() - 1989;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Datos del Negocio</h1>
        <p className="text-muted-foreground">Ficha institucional de la empresa</p>
      </div>

      {/* Card 1 — Datos Societarios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos Societarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Table>
            <TableBody>
              {DATOS_SOCIETARIOS.map(([campo, valor]) => (
                <TableRow key={campo}>
                  <TableCell className="font-medium text-muted-foreground w-[200px]">
                    {campo}
                  </TableCell>
                  <TableCell>{valor}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium text-muted-foreground w-[200px]">
                  Antigüedad
                </TableCell>
                <TableCell>{antiguedad} años</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {/* Actividades Registradas */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Actividades Registradas (ARCA)
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Código</TableHead>
                  <TableHead>Actividad</TableHead>
                  <TableHead className="w-[80px] text-right">Alta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ACTIVIDADES_ARCA.map((a) => (
                  <TableRow key={a.codigo}>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {a.codigo}
                        {a.principal && (
                          <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{a.actividad}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">
                      {a.alta}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — Unidades de Negocio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unidades de Negocio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {UNIDADES.map((u) => {
              const Icon = u.icon;
              return (
                <div
                  key={u.nombre}
                  className="rounded-lg border bg-muted/30 p-4 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-medium">{u.nombre}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {u.descripcion}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Card 3 — Información Fiscal y Operativa */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Información Fiscal y Operativa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {INFO_FISCAL.map(([campo, valor]) => (
                <TableRow key={campo}>
                  <TableCell className="font-medium text-muted-foreground w-[200px]">
                    {campo}
                  </TableCell>
                  <TableCell>{valor}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
