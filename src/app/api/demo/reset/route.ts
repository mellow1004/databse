import { NextResponse } from "next/server";
import {
  disconnectSeedDatabase,
  runFullSeed,
} from "../../../../../prisma/seed";

export const maxDuration = 60;

export async function POST() {
  try {
    const summary = await runFullSeed();
    return NextResponse.json({
      resetAt: new Date().toISOString(),
      ...summary,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error: "reset_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  } finally {
    await disconnectSeedDatabase();
  }
}
