import { UserCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Props = {
  approvalPath: string | null | undefined;
};

export default function QuarantinePathBadge({ approvalPath }: Props) {
  const isAuto = (approvalPath ?? "manual") === "auto";
  return (
    <Badge
      className={
        isAuto
          ? "border-transparent bg-emerald-100 text-emerald-800"
          : "border-transparent bg-amber-100 text-amber-800"
      }
      title={
        isAuto
          ? "Stale records auto-return after re-verification passes"
          : "Requires Data Owner approval"
      }
    >
      {isAuto ? (
        <>
          <Zap className="mr-1 size-3" aria-hidden />
          Auto
        </>
      ) : (
        <>
          <UserCheck className="mr-1 size-3" aria-hidden />
          Manual
        </>
      )}
    </Badge>
  );
}
