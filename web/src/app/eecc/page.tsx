import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EECCPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">EECC</h1>
        <p className="text-muted-foreground">
          Estados contables auditados e indicadores financieros
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="hover:bg-accent/50 transition-colors">
          <Link href="/eecc/balance">
            <CardHeader>
              <CardTitle className="text-base">Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Estado de Situación Patrimonial y Estado de Resultados Contable
              </p>
            </CardContent>
          </Link>
        </Card>
        <Card className="hover:bg-accent/50 transition-colors">
          <Link href="/eecc/indicadores">
            <CardHeader>
              <CardTitle className="text-base">Indicadores</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Rentabilidad, liquidez, apalancamiento y eficiencia
              </p>
            </CardContent>
          </Link>
        </Card>
      </div>
    </div>
  );
}
