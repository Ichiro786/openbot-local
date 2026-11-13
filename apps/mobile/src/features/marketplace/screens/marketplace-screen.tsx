import { router, useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, ScrollView, View, type ViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectorLogo } from "@/features/servers/components/connector-logo";
import { SettingsNote, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidBlurTarget } from "@/shared/components/android-header-blur";
import { Button } from "@/shared/components/button";
import { GLASS_CAPSULE_HEIGHT } from "@/shared/components/glass-capsule";
import { LargeTitle, LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { AgentCard, AppTile, FeaturedAgent, ListingRow } from "../components/marketplace-parts";
import { MarketplaceSearchBar } from "../components/marketplace-search-bar";
import {
  byPopularity,
  CATEGORY_LABELS,
  isMarketplaceFiltered,
  KIND_LABELS,
  type MarketplaceFilter,
  type MarketplaceKind,
  type MarketplaceListing,
  matchesFilter,
  NO_MARKETPLACE_FILTER,
} from "../model/marketplace-listings";
import {
  type MarketplaceCatalog,
  type MarketplaceInstalled,
  useMarketplaceCatalog,
  useMarketplaceInstalled,
} from "../model/use-marketplace";

/** The agents of the shelf and the skills of the list on the overview. */
const OVERVIEW_ROWS = 8;
/** The apps of the grid on the overview: two rows of four. */
const OVERVIEW_APPS = 8;

/**
 * The Marketplace of one server, from the drawer. The overview shows a featured agent, the popular
 * agents, the apps and the popular skills. The field at the bottom searches, and its filter menu
 * narrows the page to one kind, one category, or what the server already has.
 */
export function MarketplaceScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const server = useMobileWorkspaceSelector((workspace) => workspace.servers.find((item) => item.id === serverId));
  const scroll = useLargeTitleScroll();
  const blurTarget = useRef<ViewInstance>(null);
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<MarketplaceFilter>(NO_MARKETPLACE_FILTER);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const fullCatalog = useMarketplaceCatalog({ serverId, query, filter });
  const whatsappAvailable = useMobileWorkspaceSelector((workspace) => workspace.canManageWhatsApp(serverId));
  // OpenBot Local: on an engine with our WhatsApp page, its tile is the one WhatsApp entry (upstream's
  // WhatsApp connector app is left out of the lists).
  const catalog = whatsappAvailable
    ? {
        ...fullCatalog,
        listings: fullCatalog.listings.filter(
          (item) => !(item.kind === "app" && item.source === "connector" && item.connector === "whatsapp"),
        ),
      }
    : fullCatalog;
  const installed = useMarketplaceInstalled(serverId);
  const title = t("mobile.app.route.marketplace");
  const listing = (item: MarketplaceListing) => {
    // A connector and an MCP server that the user added open their own pages, as on the desktop.
    if (item.kind === "app" && item.source === "connector") {
      router.push({ pathname: "/server-settings/connector", params: { serverId, id: item.connector } });
      return;
    }
    if (item.kind === "app" && item.source === "custom") {
      router.push({ pathname: "/server-settings/mcp-server", params: { serverId, mcpServerId: item.server.id } });
      return;
    }
    // The name goes along, so the sheet has its title before the listing loads.
    router.push({
      pathname: "/marketplace-listing",
      params: { serverId, kind: item.kind, id: item.id, name: item.name },
    });
  };
  const showAll = (kind: MarketplaceKind) => {
    void haptics.selection();
    setFilter({ ...NO_MARKETPLACE_FILTER, kind });
  };
  const listMode = isMarketplaceFiltered(filter) || catalog.search.length > 0;

  // The agents and skills did not load. The bundled apps still show under it, with a way to retry.
  const loadFailed =
    server && catalog.failed ? (
      <View className="items-center gap-3 px-6 py-4">
        <Typography.Paragraph align="center" className="text-grouped-secondary">
          {t("mobile.marketplace.loadFailed")}
        </Typography.Paragraph>
        <Button variant="secondary" onPress={() => void catalog.refetch()}>
          <Button.Label>{t("common.tryAgain")}</Button.Label>
        </Button>
      </View>
    ) : null;
  let content: ReactNode;
  if (!server) content = <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>;
  else if (listMode)
    content = (
      <FilteredList
        listings={catalog.listings.filter((item) => matchesFilter(item, filter, installed.installed))}
        filter={filter}
        pending={catalog.pending}
        more={catalog}
        installed={installed}
        onOpen={listing}
        onClear={() => {
          void haptics.selection();
          setFilter(NO_MARKETPLACE_FILTER);
          setQuery("");
        }}
      />
    );
  else
    content = (
      <Overview
        listings={catalog.listings}
        pending={catalog.pending}
        installed={installed}
        onOpen={listing}
        onShowAll={showAll}
        onWhatsApp={
          whatsappAvailable
            ? () => router.push({ pathname: "/server-settings/whatsapp", params: { serverId } })
            : undefined
        }
      />
    );

  return (
    <View className="flex-1 bg-sheet">
      <AndroidBlurTarget target={blurTarget} surface="sheet">
        <Animated.ScrollView
          className="flex-1"
          // The side insets go outside the scroll view, as in `LargeTitleScrollView`.
          style={{ marginLeft: insets.left, marginRight: insets.right }}
          contentInsetAdjustmentBehavior={scroll.ownsInset ? "never" : "always"}
          // Android has no content inset, so the content starts below the transparent header. The bottom
          // keeps the last row above the field.
          contentContainerStyle={{
            paddingTop: scroll.ownsInset ? scroll.headerHeight : 0,
            paddingBottom: insets.bottom + GLASS_CAPSULE_HEIGHT + 32,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          onScroll={scroll.onScroll}
        >
          <LargeTitle scroll={scroll} title={title} caption={server?.name} />
          <View className="gap-7 pt-3">
            {loadFailed}
            {content}
          </View>
        </Animated.ScrollView>
      </AndroidBlurTarget>
      <LargeTitleBar scroll={scroll} title={title} surface="sheet" blurTarget={blurTarget} />
      {server ? (
        <MarketplaceSearchBar
          query={query}
          onQueryChange={setQuery}
          filter={filter}
          onFilterChange={setFilter}
          focused={focused}
          onFocusedChange={setFocused}
        />
      ) : null}
    </View>
  );
}

function SectionHeader({ title, onShowAll }: { title: string; onShowAll?: () => void }) {
  const { t } = useText();
  return (
    <View className="flex-row items-baseline justify-between px-5">
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {onShowAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.marketplace.overview.seeAllOf", { name: title })}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          onPress={onShowAll}
        >
          <Typography.Paragraph className="text-accent-text" style={typeScale.preview}>
            {t("mobile.marketplace.overview.seeAll")}
          </Typography.Paragraph>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A listing's installs. Apps have no install count. */
/** OpenBot Local: the WhatsApp tile of the apps grid; it opens Server settings › Connectors › WhatsApp. */
function WhatsAppTile({ onPress }: { onPress: () => void }) {
  const { t } = useText();
  const name = t("mobile.server.connectors.whatsapp.title");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      className="w-1/4 items-center gap-1.5 py-2"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <ConnectorLogo id="whatsapp" size={54} />
      <Typography.Paragraph numberOfLines={1} align="center" style={typeScale.small}>
        {name}
      </Typography.Paragraph>
    </Pressable>
  );
}

function installsOf(listing: MarketplaceListing): number {
  return listing.kind === "app" ? 0 : listing.installs;
}

function Overview({
  listings,
  pending,
  installed,
  onOpen,
  onShowAll,
  onWhatsApp,
}: {
  listings: MarketplaceListing[];
  pending: boolean;
  /** OpenBot Local (build 11): WhatsApp, on an engine that serves `whatsapp-mobile-v1`. */
  onWhatsApp?: () => void;
  installed: MarketplaceInstalled;
  onOpen: (listing: MarketplaceListing) => void;
  onShowAll: (kind: MarketplaceKind) => void;
}) {
  const { t } = useText();
  const agents = listings.filter((item) => item.kind === "agent").sort(byPopularity);
  const apps = listings.filter((item) => item.kind === "app").sort(byPopularity);
  const skills = listings.filter((item) => item.kind === "skill").sort(byPopularity);
  // The banner shows the agent with the most installs, so it follows the catalog as installs change.
  // The catalog page is sorted by installs, so its first page holds the top agent.
  const featured = agents.reduce<MarketplaceListing | undefined>(
    (top, item) => (top === undefined || installsOf(item) > installsOf(top) ? item : top),
    undefined,
  );
  const shelf = agents.filter((item) => item !== featured);
  return (
    <>
      {featured ? (
        <View className="px-4">
          <FeaturedAgent
            listing={featured}
            installed={installed.installed(featured)}
            onPress={() => onOpen(featured)}
          />
        </View>
      ) : null}
      {shelf.length > 0 ? (
        <View className="gap-3">
          <SectionHeader title={t("mobile.marketplace.overview.agents")} onShowAll={() => onShowAll("agent")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
            {shelf.slice(0, OVERVIEW_ROWS).map((item) => (
              <AgentCard
                key={item.id}
                listing={item}
                installed={installed.installed(item)}
                onPress={() => onOpen(item)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View className="gap-1">
        <SectionHeader title={t("mobile.marketplace.overview.apps")} onShowAll={() => onShowAll("app")} />
        <View className="flex-row flex-wrap px-2">
          {onWhatsApp ? <WhatsAppTile onPress={onWhatsApp} /> : null}
          {apps.slice(0, onWhatsApp ? OVERVIEW_APPS - 1 : OVERVIEW_APPS).map((item) => (
            <AppTile key={item.id} listing={item} installed={installed.installed(item)} onPress={() => onOpen(item)} />
          ))}
        </View>
      </View>
      {skills.length > 0 ? (
        <View className="gap-3">
          <SectionHeader title={t("mobile.marketplace.overview.skills")} onShowAll={() => onShowAll("skill")} />
          <View className="px-4">
            <SettingsSection>
              {skills.slice(0, OVERVIEW_ROWS).map((item) => (
                <ListingRow
                  key={item.id}
                  listing={item}
                  installed={installed.installed(item)}
                  showKind={false}
                  onPress={() => onOpen(item)}
                />
              ))}
            </SettingsSection>
          </View>
        </View>
      ) : null}
      {pending && agents.length === 0 && skills.length === 0 ? <Spinner className="self-center" /> : null}
    </>
  );
}

function FilteredList({
  listings,
  filter,
  pending,
  more,
  installed,
  onOpen,
  onClear,
}: {
  listings: MarketplaceListing[];
  filter: MarketplaceFilter;
  pending: boolean;
  /** The next catalog page, as the desktop "Load more". */
  more: Pick<MarketplaceCatalog, "hasMore" | "loadingMore" | "loadMoreFailed" | "loadMore">;
  installed: MarketplaceInstalled;
  onOpen: (listing: MarketplaceListing) => void;
  onClear: () => void;
}) {
  const { t } = useText();
  const parts = [
    filter.kind ? t(KIND_LABELS[filter.kind]) : null,
    filter.category ? t(CATEGORY_LABELS[filter.category]) : null,
    filter.installed ? t("mobile.marketplace.installed") : null,
  ].filter(Boolean);
  return (
    <View className="gap-3 px-4">
      {parts.length > 0 ? (
        <View className="flex-row items-baseline justify-between px-1">
          <Typography.Paragraph
            numberOfLines={1}
            className="min-w-0 flex-1 text-grouped-secondary"
            style={typeScale.preview}
          >
            {parts.join(" · ")}
          </Typography.Paragraph>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onClear}>
            <Typography.Paragraph className="text-accent-text" style={typeScale.preview}>
              {t("mobile.marketplace.filter.clear")}
            </Typography.Paragraph>
          </Pressable>
        </View>
      ) : null}
      {listings.length > 0 ? (
        <SettingsSection>
          {listings.map((item) => (
            <ListingRow
              key={`${item.kind}:${item.id}`}
              listing={item}
              installed={installed.installed(item)}
              showKind={filter.kind === null}
              onPress={() => onOpen(item)}
            />
          ))}
        </SettingsSection>
      ) : pending ? (
        <Spinner className="self-center" />
      ) : (
        <SettingsNote>{t("mobile.marketplace.empty")}</SettingsNote>
      )}
      {more.loadMoreFailed ? <SettingsNote>{t("mobile.marketplace.loadFailed")}</SettingsNote> : null}
      {more.hasMore ? (
        <Button
          variant="secondary"
          className="self-center"
          isDisabled={more.loadingMore}
          onPress={() => void more.loadMore()}
        >
          <Button.Label>{t("mobile.marketplace.loadMore")}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
