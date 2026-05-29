import { Badge } from "@/components/ui/badge";
import OpenDemotionReviewButton from "./OpenDemotionReviewButton";

type Props = {
  provider: string;
  cycleNumber: number | null;
  accuracyRate: number | null;
  reviewed?: number;
};

export default function ProviderQualityThresholdBadges({
  provider,
  cycleNumber,
  accuracyRate,
  reviewed = 0,
}: Props) {
  if (accuracyRate === null || reviewed < 10 || accuracyRate >= 85) return null;

  if (accuracyRate < 75) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-red-100 text-red-800">
          🚨 Below 75% — demotion review required
        </Badge>
        {cycleNumber !== null ? (
          <OpenDemotionReviewButton
            provider={provider}
            cycleNumber={cycleNumber}
            accuracyRate={accuracyRate}
          />
        ) : null}
      </div>
    );
  }

  return (
    <Badge className="border-transparent bg-amber-100 text-amber-800">
      ⚠ Below 85% — investigation recommended
    </Badge>
  );
}
