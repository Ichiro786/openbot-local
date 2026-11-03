// E2E HARNESS: same shape as app/(app)/add-agent/_layout.tsx (formSheet route holding a SheetPageStack).
import { SheetPageStack } from "@/shared/components/sheet-page-stack";

export const unstable_settings = { anchor: "index" };

export default function E2ESheetLayout() {
  return <SheetPageStack title="Create agent" clearHeader />;
}
