/** Human-readable gate labels for UI (DB values unchanged). */
export function formatGateStatus(gate: string | null | undefined): string {
  if (!gate) return "—";
  if (gate === "gate_0") return "Staging";
  if (gate === "gate_1") return "Gate 1";
  if (gate === "gate_2") return "Gate 2";
  if (gate === "gate_3") return "Gate 3";
  return gate.replace(/_/g, " ");
}
