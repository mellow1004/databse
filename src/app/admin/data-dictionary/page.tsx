import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DATA_DICTIONARY } from "@/lib/data-dictionary";

export const dynamic = "force-dynamic";

export default function DataDictionaryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data dictionary</h1>
        <p className="text-sm text-slate-600">
          Reference map of key models, fields, gate requirements, and sensitivity.
        </p>
      </div>

      {DATA_DICTIONARY.map((model) => (
        <Card key={model.model} className="shadow-sm">
          <CardHeader>
            <CardTitle>{model.model}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required by gate</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Source rule</TableHead>
                  <TableHead>Sensitivity tier</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.fields.map((field) => (
                  <TableRow key={field.name}>
                    <TableCell className="font-mono text-xs">{field.name}</TableCell>
                    <TableCell>{field.type}</TableCell>
                    <TableCell>{field.requiredByGate}</TableCell>
                    <TableCell>{field.defaultValue}</TableCell>
                    <TableCell>{field.sourceRule}</TableCell>
                    <TableCell>{field.sensitivityTier}</TableCell>
                    <TableCell>{field.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
