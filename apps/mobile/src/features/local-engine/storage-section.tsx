// OpenBot Local: Server settings → Local engine → Storage. A donut of what the app's private
// storage holds (EngineStorage.kt measures it), a legend that says what each part is, and the
// scan's findings of what is stuck or no longer needed, each with a confirmed, guarded cleanup.
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { Button } from "@/shared/components/button";
import { type DonutArc, DonutChart, donutArcs } from "@/shared/components/donut-chart";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

import { type StorageCategory, type StorageScan, storageClean, storageScan } from "../../../modules/openbot-engine";
import {
  androidDataBytes,
  type FindingKind,
  reclaimableBytes,
  STORAGE_ORDER,
  type StorageFinding,
  storageFindings,
  storageSegments,
} from "./storage-model";

const layout = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);
const enter = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const leave = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

/** Mid tones that read on the AMOLED black sheet and on the light one. */
const COLOR: Record<StorageCategory, string> = {
  engineSystem: "#5B8DEF",
  workspaces: "#34A853",
  openbotData: "#A56EF2",
  antigravity: "#F4B400",
  otherUserData: "#1FB5C9",
  packageCaches: "#FA7B17",
  toolCaches: "#E8710A",
  otherCaches: "#B98A57",
  previous: "#EA4335",
  partial: "#E8467C",
  downloads: "#D93F8E",
  logs: "#8D96A0",
  appCache: "#6FA8FF",
  other: "#6E7681",
};

const LABEL = {
  engineSystem: "mobile.settings.storage.category.engineSystem",
  workspaces: "mobile.settings.storage.category.workspaces",
  openbotData: "mobile.settings.storage.category.openbotData",
  antigravity: "mobile.settings.storage.category.antigravity",
  otherUserData: "mobile.settings.storage.category.otherUserData",
  packageCaches: "mobile.settings.storage.category.packageCaches",
  toolCaches: "mobile.settings.storage.category.toolCaches",
  otherCaches: "mobile.settings.storage.category.otherCaches",
  previous: "mobile.settings.storage.category.previous",
  partial: "mobile.settings.storage.category.partial",
  downloads: "mobile.settings.storage.category.downloads",
  logs: "mobile.settings.storage.category.logs",
  appCache: "mobile.settings.storage.category.appCache",
  other: "mobile.settings.storage.category.other",
} as const satisfies Record<StorageCategory, MobileTextKey>;

const EXPLAIN = {
  engineSystem: "mobile.settings.storage.category.engineSystem.explain",
  workspaces: "mobile.settings.storage.category.workspaces.explain",
  openbotData: "mobile.settings.storage.category.openbotData.explain",
  antigravity: "mobile.settings.storage.category.antigravity.explain",
  otherUserData: "mobile.settings.storage.category.otherUserData.explain",
  packageCaches: "mobile.settings.storage.category.packageCaches.explain",
  toolCaches: "mobile.settings.storage.category.toolCaches.explain",
  otherCaches: "mobile.settings.storage.category.otherCaches.explain",
  previous: "mobile.settings.storage.category.previous.explain",
  partial: "mobile.settings.storage.category.partial.explain",
  downloads: "mobile.settings.storage.category.downloads.explain",
  logs: "mobile.settings.storage.category.logs.explain",
  appCache: "mobile.settings.storage.category.appCache.explain",
  other: "mobile.settings.storage.category.other.explain",
} as const satisfies Record<StorageCategory, MobileTextKey>;

const FINDING_TITLE = {
  previousEngine: "mobile.settings.storage.finding.previousEngine",
  interruptedInstall: "mobile.settings.storage.finding.interruptedInstall",
  oldDownloads: "mobile.settings.storage.finding.oldDownloads",
  bigCaches: "mobile.settings.storage.finding.bigCaches",
  bigLogs: "mobile.settings.storage.finding.bigLogs",
  appCache: "mobile.settings.storage.finding.appCache",
} as const satisfies Record<FindingKind, MobileTextKey>;

const FINDING_BODY = {
  previousEngine: "mobile.settings.storage.finding.previousEngine.body",
  interruptedInstall: "mobile.settings.storage.finding.interruptedInstall.body",
  oldDownloads: "mobile.settings.storage.finding.oldDownloads.body",
  bigCaches: "mobile.settings.storage.finding.bigCaches.body",
  bigLogs: "mobile.settings.storage.finding.bigLogs.body",
  appCache: "mobile.settings.storage.finding.appCache.body",
} as const satisfies Record<FindingKind, MobileTextKey>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Arcs for every category in legend order: an empty one keeps a zero-length arc at its place. */
function allArcs(scan: StorageScan | null): DonutArc[] {
  return donutArcs(
    STORAGE_ORDER.map((category) => ({ key: category, color: COLOR[category], value: scan?.sizes[category] ?? 0 })),
  );
}

type Confirm = { findings: StorageFinding[] };

export function StorageSection({ installing }: { installing: boolean }) {
  const { t, format } = useText();
  const [scan, setScan] = useState<StorageScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progressBytes, setProgressBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const runScan = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setScanning(true);
    setError(null);
    setProgressBytes(0);
    try {
      const result = await storageScan((event) => {
        if (alive.current) setProgressBytes(event.bytes);
      });
      if (alive.current) setScan(result);
    } catch (failure) {
      if (alive.current) setError(describe(failure));
    } finally {
      busy.current = false;
      if (alive.current) setScanning(false);
    }
  }, []);

  useEffect(() => {
    // After the page's open animation: the walk is native and off the UI thread, but its first
    // progress renders should not land on the push.
    const timer = setTimeout(() => void runScan(), 450);
    return () => clearTimeout(timer);
  }, [runScan]);

  const findings = useMemo(
    () => (scan ? storageFindings({ ...scan, installing: scan.installing || installing }) : []),
    [scan, installing],
  );
  const segments = useMemo(() => (scan ? storageSegments(scan) : []), [scan]);
  const arcs = useMemo(() => allArcs(scan), [scan]);
  const nodeModules = scan?.sizes.nodeModules ?? 0;
  const androidData = scan ? androidDataBytes(scan) : null;

  const footer = scan
    ? [
        androidData != null && scan.android
          ? t("mobile.settings.storage.android", {
              data: format.fileSize(androidData),
              app: format.fileSize(scan.android.appBytes),
            })
          : null,
        scan.deviceFree > 0 ? t("mobile.settings.storage.free", { size: format.fileSize(scan.deviceFree) }) : null,
        scan.complete ? null : t("mobile.settings.storage.incomplete"),
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;

  const clean = async (items: StorageFinding[]) => {
    setConfirm(null);
    setCleaning(true);
    setNote(null);
    let freed = 0;
    let failure: string | null = null;
    for (const item of items) {
      try {
        freed += await storageClean(item.category);
      } catch (cause) {
        failure = t("mobile.settings.storage.cleanFailed", {
          name: t(FINDING_TITLE[item.kind]),
          error: describe(cause),
        });
        break;
      }
    }
    if (!alive.current) return;
    setCleaning(false);
    setNote(
      failure
        ? { text: failure, error: true }
        : { text: t("mobile.settings.storage.cleaned", { size: format.fileSize(freed) }), error: false },
    );
    void haptics.notification(failure ? "error" : "success");
    await runScan();
  };

  const totalLabel = scan ? format.fileSize(scan.total) : scanning ? format.fileSize(progressBytes) : "–";
  const caption = scanning && !scan ? t("mobile.settings.storage.scanning") : t("mobile.settings.storage.totalLabel");
  const disabled = cleaning || scanning || installing;

  return (
    <>
      <Animated.View layout={layout}>
        <SettingsSection title={t("mobile.settings.storage.title")} footer={footer || undefined}>
          <View className="items-center px-4 pt-5 pb-4" testID="storage-card">
            <DonutChart arcs={arcs} totalLabel={totalLabel} caption={caption} />
          </View>
          {segments.map((segment) => (
            <SettingsRow
              key={segment.category}
              disclosure={false}
              leading={
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR[segment.category] }} />
              }
              trailing={
                <Typography.Paragraph className="text-grouped-secondary">
                  {format.fileSize(segment.bytes)}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{t(LABEL[segment.category])}</Typography.Paragraph>
              <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                {t(EXPLAIN[segment.category])}
                {segment.category === "workspaces" && nodeModules > 0
                  ? ` ${t("mobile.settings.storage.nodeModules", { size: format.fileSize(nodeModules) })}`
                  : null}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
          <SettingsRow disclosure={false} disabled={scanning || cleaning} onPress={() => void runScan()}>
            <Typography.Paragraph className="text-accent">
              {scanning
                ? scan
                  ? t("mobile.settings.storage.scanning")
                  : t("mobile.settings.storage.scanningProgress", { size: format.fileSize(progressBytes) })
                : t("mobile.settings.storage.rescan")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </Animated.View>

      {scan ? (
        <Animated.View layout={layout} entering={enter}>
          <SettingsSection title={t("mobile.settings.storage.findings.title")}>
            {installing ? (
              <SettingsRow disclosure={false}>
                <Typography.Paragraph className="text-grouped-secondary">
                  {t("mobile.settings.storage.findings.installing")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : findings.length === 0 ? (
              <SettingsRow disclosure={false}>
                <Typography.Paragraph className="text-grouped-secondary">
                  {t("mobile.settings.storage.findings.empty")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : (
              findings.map((finding) => (
                <SettingsRow
                  key={finding.kind}
                  disclosure={false}
                  leading={
                    <View
                      style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR[finding.category] }}
                    />
                  }
                  trailing={
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={disabled}
                      onPress={() => setConfirm({ findings: [finding] })}
                    >
                      <Button.Label>{t("mobile.settings.storage.cleanUp")}</Button.Label>
                    </Button>
                  }
                >
                  <Typography.Paragraph>
                    {t(FINDING_TITLE[finding.kind])} · {format.fileSize(finding.bytes)}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                    {t(FINDING_BODY[finding.kind])}
                  </Typography.Paragraph>
                </SettingsRow>
              ))
            )}
            {findings.length > 0 && !installing ? (
              <SettingsRow disclosure={false} disabled={disabled} onPress={() => setConfirm({ findings })}>
                <Typography.Paragraph className="text-accent">
                  {cleaning
                    ? t("mobile.settings.storage.cleaning")
                    : `${t("mobile.settings.storage.cleanAll")} · ${format.fileSize(reclaimableBytes(findings))}`}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
        </Animated.View>
      ) : null}

      {confirm ? (
        <Animated.View layout={layout} entering={enter} exiting={leave}>
          <ConfirmSheet
            confirm={confirm}
            onCancel={() => setConfirm(null)}
            onConfirm={() => void clean(confirm.findings)}
          />
        </Animated.View>
      ) : null}

      {note || error ? (
        <Animated.View layout={layout} entering={enter} exiting={leave}>
          <Typography.Paragraph
            accessibilityRole={error || note?.error ? "alert" : undefined}
            className={`px-4 ${error || note?.error ? "text-danger-text" : "text-grouped-secondary"}`}
          >
            {error ? t("mobile.settings.storage.scanFailed", { error }) : note?.text}
          </Typography.Paragraph>
        </Animated.View>
      ) : null}
    </>
  );
}

/** States what goes and how much it frees before anything is deleted. */
function ConfirmSheet({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: Confirm;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, format } = useText();
  const items = confirm.findings;
  const first = items[0];
  const title =
    items.length === 1 && first
      ? t("mobile.settings.storage.confirm.title", { name: t(FINDING_TITLE[first.kind]) })
      : t("mobile.settings.storage.confirm.allTitle");
  const removes = items.map((item) => `${t(FINDING_TITLE[item.kind])} (${format.fileSize(item.bytes)})`).join(", ");
  return (
    <View className="gap-3 rounded-grouped bg-grouped p-4" accessibilityRole="alert">
      <Typography type="h5" className="text-foreground">
        {title}
      </Typography>
      <Typography.Paragraph className="text-grouped-secondary">
        {t("mobile.settings.storage.confirm.removes", { items: removes })}{" "}
        {t("mobile.settings.storage.confirm.frees", { size: format.fileSize(reclaimableBytes(items)) })}
      </Typography.Paragraph>
      <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
        {t("mobile.settings.storage.confirm.keeps")}
      </Typography.Paragraph>
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onCancel}>
          <Button.Label>{t("mobile.settings.storage.cancel")}</Button.Label>
        </Button>
        <Button variant="danger" size="sm" onPress={onConfirm}>
          <Button.Label>{t("mobile.settings.storage.cleanUp")}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
