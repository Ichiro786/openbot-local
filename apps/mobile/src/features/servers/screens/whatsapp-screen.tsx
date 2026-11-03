import type { MessagingConnection, WhatsAppAccount, WhatsAppGroup, WhatsAppLinkState } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { useUniwind } from "uniwind";
import { ConnectorError, ConnectorHeader } from "@/features/servers/components/connector-header";
import { useConnectorAction } from "@/features/servers/model/use-server-connectors";
import {
  formatPairingCode,
  isWhatsAppNumber,
  LINK_POLL_MS,
  useWhatsApp,
  whatsappDigits,
} from "@/features/servers/model/use-whatsapp";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const STATE_KEYS = new Map<string, MobileTextKey>([
  ["connected", "mobile.server.connectors.whatsapp.state.connected"],
  ["connecting", "mobile.server.connectors.whatsapp.state.connecting"],
  ["reconnecting", "mobile.server.connectors.whatsapp.state.connecting"],
  ["paused", "mobile.server.connectors.whatsapp.state.paused"],
]);

const FAILED_KEYS = new Map<string, MobileTextKey>([
  ["timeout", "mobile.server.connectors.whatsapp.failed.timeout"],
  ["refused", "mobile.server.connectors.whatsapp.failed.refused"],
  ["unavailable", "mobile.server.connectors.whatsapp.failed.unavailable"],
]);

function stateKey(state: string): MobileTextKey {
  return STATE_KEYS.get(state) ?? "mobile.server.connectors.whatsapp.state.error";
}

/** A connection that needs the user: stopped with an error, paused, or without saved keys. */
function needsReconnect(connection: MessagingConnection): boolean {
  return connection.state !== "connected" && connection.state !== "connecting" && connection.state !== "reconnecting";
}

/**
 * OpenBot Local (build 11): Server settings › Connectors › WhatsApp. The engine on this phone links as a
 * linked device of a number with an 8-character pairing code (the phone cannot scan its own QR code).
 * Numbers, the shared WhatsApp Orchestrator, allowed senders and pairing requests, as on the desktop.
 * Hidden on an engine without `whatsapp-mobile-v1`.
 */
export function WhatsAppScreen() {
  const text = useText();
  const { t, errorMessage } = text;
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, agents } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const whatsapp = useWhatsApp(serverId);
  const action = useConnectorAction(whatsapp.overview.refetch);
  const dark = useUniwind().theme === "dark";
  const [phone, setPhone] = useState("");
  const [ownNumber, setOwnNumber] = useState(true);
  const [link, setLink] = useState<WhatsAppLinkState | null>(null);
  const [linkError, setLinkError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const waiting = link?.status === "waiting";
  // The link that runs, for the cancel on leaving the page.
  const running = useRef(false);
  running.current = waiting;
  // The latest calls, so the poll and the cancel on leaving keep one timer and one cleanup.
  const api = useRef(whatsapp);
  api.current = whatsapp;

  // A running link is read again until the code shows and the phone confirms, as the desktop page does.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      api.current.linkState().then(
        (next) => {
          setLink(next);
          if (next.status === "linked") {
            void haptics.notification("success");
            void api.current.overview.refetch();
          }
        },
        (error: unknown) => setLinkError(error),
      );
    }, LINK_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  // Leaving the page while a code waits stops the link on the host.
  useEffect(
    () => () => {
      if (running.current) void api.current.linkCancel().catch(() => undefined);
    },
    [],
  );

  if (!server || !whatsapp.available)
    return (
      <SettingsContent>
        <SettingsNote>
          {t(server ? "mobile.server.connectors.whatsapp.unsupported" : "mobile.server.unavailable")}
        </SettingsNote>
      </SettingsContent>
    );
  const data = whatsapp.overview.data;
  if (!data)
    return (
      <SettingsContent>
        <Stack.Screen options={{ title: t("mobile.server.connectors.whatsapp.title") }} />
        <SettingsNote>
          {whatsapp.overview.isError
            ? errorMessage(whatsapp.overview.error, t("mobile.server.connectors.readFailed"))
            : t("mobile.server.connectors.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  const connections = data.connections;
  const orchestratorId = connections.find((item) => item.orchestratorAgentId)?.orchestratorAgentId ?? null;
  const orchestrator = orchestratorId
    ? agents.find((agent) => agent.id === orchestratorId && agent.serverId === serverId)
    : undefined;
  const failure = action.error
    ? errorMessage(action.error, t("mobile.server.connectors.whatsapp.failedAction"))
    : linkError
      ? errorMessage(linkError, t("mobile.server.connectors.whatsapp.failedAction"))
      : null;
  const phoneValid = isWhatsAppNumber(phone);

  const start = () => {
    setLinkError(null);
    setCopied(false);
    void action.perform(async () => {
      setLink(await whatsapp.linkStart(phone.trim(), ownNumber));
    });
  };
  const cancel = () => {
    setLink(null);
    void action.perform(async () => {
      await whatsapp.linkCancel();
    });
  };
  const copy = async () => {
    if (!link?.code) return;
    await Clipboard.setStringAsync(link.code);
    setCopied(true);
    void haptics.notification("success");
  };
  const disconnect = (connection: MessagingConnection) =>
    Alert.alert(
      t("mobile.server.connectors.whatsapp.disconnectTitle", { number: `+${connection.workspaceId}` }),
      t("mobile.server.connectors.whatsapp.disconnectMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.connectors.whatsapp.disconnect"),
          style: "destructive",
          onPress: () =>
            void action.perform(async () => {
              await whatsapp.disconnect(connection.workspaceId);
            }),
        },
      ],
    );

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.connectors.whatsapp.title") }} />
      <ConnectorHeader
        id="whatsapp"
        status={
          connections.length > 0
            ? t(stateKey(connections[0]?.state ?? ""))
            : t("mobile.server.connectors.statusNotSetUp")
        }
        attention={connections.some(needsReconnect)}
        description={t("mobile.server.connectors.whatsapp.description")}
      />
      <ConnectorError message={failure} />

      {connections.map((connection) => (
        <NumberSection
          key={connection.workspaceId}
          connection={connection}
          account={data.accounts.find((item) => item.workspaceId === connection.workspaceId)}
          busy={action.busy}
          dark={dark}
          whatsapp={whatsapp}
          perform={action.perform}
          onDisconnect={() => disconnect(connection)}
        />
      ))}

      {connections.length > 0 ? (
        <SettingsSection
          title={t("mobile.server.connectors.whatsapp.orchestrator")}
          footer={orchestrator ? undefined : t("mobile.server.connectors.whatsapp.orchestratorMissing")}
        >
          {orchestrator ? (
            <SettingsRow
              onPress={() => router.push({ pathname: "/chat/[agentId]", params: { agentId: orchestrator.id } })}
            >
              <Typography.Paragraph>{orchestrator.name}</Typography.Paragraph>
            </SettingsRow>
          ) : (
            <SettingsRow
              disclosure={false}
              disabled={action.busy}
              onPress={() =>
                void action.perform(async () => {
                  await whatsapp.addOrchestrator();
                })
              }
            >
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.connectors.whatsapp.addOrchestrator")}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      ) : null}

      {link && link.status !== "idle" ? (
        <SettingsSection title={t("mobile.server.connectors.whatsapp.codeTitle")}>
          {link.status === "waiting" && !link.code ? (
            <SettingsRow disclosure={false} trailing={<Spinner size="sm" />}>
              <Typography.Paragraph>{t("mobile.server.connectors.whatsapp.waitingCode")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {link.status === "waiting" && link.code ? (
            <>
              <View className="items-center gap-2 px-4 py-4">
                <Typography.Heading
                  type="h2"
                  selectable
                  accessibilityLabel={link.code.split("").join(" ")}
                  style={{ letterSpacing: 4, fontVariant: ["tabular-nums"] }}
                >
                  {formatPairingCode(link.code)}
                </Typography.Heading>
                <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
                  {t("mobile.server.connectors.whatsapp.codeSteps")}
                </Typography.Paragraph>
              </View>
              <SettingsRow disclosure={false} onPress={() => void copy()}>
                <Typography.Paragraph className="text-accent">
                  {t(
                    copied ? "mobile.server.connectors.whatsapp.copied" : "mobile.server.connectors.whatsapp.copyCode",
                  )}
                </Typography.Paragraph>
              </SettingsRow>
              <SettingsRow
                disclosure={false}
                onPress={() => void Linking.openURL("whatsapp://").catch(() => undefined)}
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.whatsapp.openWhatsApp")}
                </Typography.Paragraph>
              </SettingsRow>
            </>
          ) : null}
          {link.status === "linked" ? (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph>{t("mobile.server.connectors.whatsapp.linked")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {link.status === "failed" ? (
            <SettingsRow
              disclosure={false}
              supportingText={t(
                (link.error ? FAILED_KEYS.get(link.error) : undefined) ??
                  "mobile.server.connectors.whatsapp.failed.other",
              )}
            >
              <Typography.Paragraph className="text-warning-text">
                {t("mobile.server.connectors.whatsapp.failedAction")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {link.status === "waiting" ? (
            <SettingsRow disclosure={false} disabled={action.busy} onPress={cancel}>
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.connectors.whatsapp.cancel")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}

      {!waiting ? (
        <>
          <SheetFormField
            label={t("mobile.server.connectors.whatsapp.phoneLabel")}
            placeholder={t("mobile.server.connectors.whatsapp.phonePlaceholder")}
            inputMode="tel"
            maxLength={32}
            value={phone}
            editable={!action.busy}
            hint={phone && !phoneValid ? t("mobile.server.connectors.whatsapp.phoneInvalid") : undefined}
            onChangeText={(value) => {
              setPhone(value);
              action.reset();
            }}
          />
          <SettingsSection footer={t("mobile.server.connectors.whatsapp.ownNumberFooter")}>
            <SettingsRow>
              <SettingsSwitch
                value={ownNumber}
                disabled={action.busy}
                label={t("mobile.server.connectors.whatsapp.ownNumber")}
                dark={dark}
                onValueChange={setOwnNumber}
              />
            </SettingsRow>
            <SettingsRow disclosure={false} disabled={action.busy || !phoneValid} onPress={start}>
              <Typography.Paragraph className="text-accent">
                {link?.status === "failed"
                  ? t("mobile.server.connectors.whatsapp.tryAgain")
                  : t(
                      connections.length > 0
                        ? "mobile.server.connectors.whatsapp.linkAnother"
                        : "mobile.server.connectors.whatsapp.getCode",
                    )}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
    </SettingsContent>
  );
}

type WhatsAppApi = ReturnType<typeof useWhatsApp>;

/** One linked number: its switch, reconnect, own-number setting, senders, pairing requests and disconnect. */
function NumberSection({
  connection,
  account,
  busy,
  dark,
  whatsapp,
  perform,
  onDisconnect,
}: {
  connection: MessagingConnection;
  account: WhatsAppAccount | undefined;
  busy: boolean;
  dark: boolean;
  whatsapp: WhatsAppApi;
  perform: (operation: () => Promise<void>) => Promise<boolean>;
  onDisconnect: () => void;
}) {
  const { t } = useText();
  const id = connection.workspaceId;
  const [contact, setContact] = useState("");
  const [contactName, setContactName] = useState("");
  const [groups, setGroups] = useState<WhatsAppGroup[] | null>(null);
  const run = (operation: () => Promise<unknown>) =>
    void perform(async () => {
      await operation();
    });
  const allowed = account?.allowedSenders ?? [];
  const requests = account?.pendingRequests ?? [];
  return (
    <>
      <SettingsSection title={`+${id}`}>
        <SettingsRow
          disclosure={false}
          supportingText={
            connection.workspaceName && connection.workspaceName !== id ? connection.workspaceName : undefined
          }
          trailing={
            <Typography.Paragraph
              type="body-xs"
              className={needsReconnect(connection) ? "text-warning-text" : "text-grouped-secondary"}
            >
              {t(stateKey(connection.state))}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.connectors.whatsapp.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow>
          <SettingsSwitch
            value={connection.enabled}
            disabled={busy}
            label={t("mobile.server.connectors.whatsapp.enabled")}
            dark={dark}
            onValueChange={(enabled) => run(() => whatsapp.setEnabled(id, enabled))}
          />
        </SettingsRow>
        {account ? (
          <SettingsRow>
            <SettingsSwitch
              value={account.ownNumber}
              disabled={busy}
              label={t("mobile.server.connectors.whatsapp.ownNumber")}
              dark={dark}
              onValueChange={(own) => run(() => whatsapp.setOwnNumber(id, own))}
            />
          </SettingsRow>
        ) : null}
        {needsReconnect(connection) ? (
          <SettingsRow disclosure={false} disabled={busy} onPress={() => run(() => whatsapp.reconnect(id))}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.whatsapp.reconnect")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      {requests.length > 0 ? (
        <SettingsSection title={t("mobile.server.connectors.whatsapp.requests")}>
          {requests.map((request) => (
            <SettingsRow
              key={request.code}
              disclosure={false}
              supportingText={t("mobile.server.connectors.whatsapp.requestDetail", {
                number: `+${request.senderId}`,
                code: request.code,
              })}
              trailing={
                <View className="flex-row gap-4">
                  <Typography.Paragraph
                    accessibilityRole="button"
                    className="text-danger-text"
                    onPress={busy ? undefined : () => run(() => whatsapp.answerRequest(id, request.code, false))}
                  >
                    {t("mobile.server.connectors.whatsapp.deny")}
                  </Typography.Paragraph>
                  <Typography.Paragraph
                    accessibilityRole="button"
                    className="text-accent"
                    onPress={busy ? undefined : () => run(() => whatsapp.answerRequest(id, request.code, true))}
                  >
                    {t("mobile.server.connectors.whatsapp.approve")}
                  </Typography.Paragraph>
                </View>
              }
            >
              <Typography.Paragraph>{request.name || `+${request.senderId}`}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection
        title={t("mobile.server.connectors.whatsapp.senders")}
        footer={allowed.length === 0 ? t("mobile.server.connectors.whatsapp.noSenders") : undefined}
      >
        {allowed.map((sender) => (
          <SettingsRow
            key={sender.id}
            disclosure={false}
            supportingText={sender.kind === "contact" ? `+${sender.id}` : undefined}
            accessibilityLabel={t("mobile.server.connectors.whatsapp.remove", { name: sender.name || sender.id })}
            trailing={
              <Typography.Paragraph type="body-sm" className="text-danger-text">
                {t("mobile.server.connectors.whatsapp.removeShort")}
              </Typography.Paragraph>
            }
            disabled={busy}
            onPress={() => run(() => whatsapp.removeSender(id, sender.id))}
          >
            <Typography.Paragraph>{sender.name || sender.id}</Typography.Paragraph>
          </SettingsRow>
        ))}
        <SettingsRow
          disclosure={false}
          disabled={busy}
          onPress={() =>
            groups
              ? setGroups(null)
              : void whatsapp.groups(id).then(
                  (list) => setGroups(list.groups),
                  () => setGroups([]),
                )
          }
          expanded={groups !== null}
        >
          <Typography.Paragraph className="text-accent">
            {t("mobile.server.connectors.whatsapp.addGroup")}
          </Typography.Paragraph>
        </SettingsRow>
        {groups?.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.connectors.whatsapp.noGroups")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {groups
          ?.filter((group) => !allowed.some((sender) => sender.id === group.id))
          .map((group) => (
            <SettingsRow
              key={group.id}
              disclosure={false}
              disabled={busy}
              onPress={() => run(() => whatsapp.addSender(id, { id: group.id, kind: "group", name: group.name }))}
            >
              <Typography.Paragraph>{group.name || group.id}</Typography.Paragraph>
            </SettingsRow>
          ))}
      </SettingsSection>

      <SheetFormField
        label={t("mobile.server.connectors.whatsapp.contactNumber")}
        placeholder={t("mobile.server.connectors.whatsapp.phonePlaceholder")}
        inputMode="tel"
        maxLength={32}
        value={contact}
        editable={!busy}
        onChangeText={setContact}
      />
      <SheetFormField
        label={t("mobile.server.connectors.whatsapp.contactName")}
        maxLength={256}
        value={contactName}
        editable={!busy}
        onChangeText={setContactName}
      />
      <SettingsSection>
        <SettingsRow
          disclosure={false}
          disabled={busy || !isWhatsAppNumber(contact)}
          onPress={() =>
            void perform(async () => {
              await whatsapp.addSender(id, {
                id: whatsappDigits(contact),
                kind: "contact",
                name: contactName.trim(),
              });
              setContact("");
              setContactName("");
            })
          }
        >
          <Typography.Paragraph className="text-accent">
            {t("mobile.server.connectors.whatsapp.addContact")}
          </Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={busy} onPress={onDisconnect}>
          <Typography.Paragraph className="text-danger-text">
            {t("mobile.server.connectors.whatsapp.disconnect")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
