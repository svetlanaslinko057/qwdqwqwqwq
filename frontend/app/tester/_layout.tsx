import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';

type IconProps = { color: string; size: number };
const HomeIcon = ({ color, size }: IconProps) => <Ionicons name="home"            size={size} color={color} />;
const QueueIcon = ({ color, size }: IconProps) => <Ionicons name="checkmark-done" size={size} color={color} />;
const HistoryIcon = ({ color, size }: IconProps) => <Ionicons name="stats-chart"  size={size} color={color} />;

/**
 * Stage 4 — Expo tester cabinet.
 *
 * Scope (frozen per /app/docs/product-scope-freeze.md, Decision 2):
 *   1. Tester Home — assigned validations + queue snapshot.
 *   2. Validation list — paginated, filter by status.
 *   3. Validation detail — pass / fail / issue actions (deep-link only).
 *   4. History / performance — past validations + accuracy metrics.
 *
 * OUT OF SCOPE: validation authoring, tester admin/oversight, bulk ops.
 * Backend (`/api/tester/*`, `/api/validation/*`) was already wired before this
 * stage — see /app/backend/server.py § TESTER ENDPOINTS.
 */
export default function TesterLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: T.surface1, borderTopColor: T.border, height: 60, paddingBottom: 8 },
          tabBarActiveTintColor: T.primary,
          tabBarInactiveTintColor: T.textMuted,
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tabs.Screen name="home"        options={{ title: 'Home',    tabBarIcon: HomeIcon }} />
        <Tabs.Screen name="validations" options={{ title: 'Queue',   tabBarIcon: QueueIcon }} />
        <Tabs.Screen name="history"     options={{ title: 'History', tabBarIcon: HistoryIcon }} />

        {/* Deep-linked detail screen — never shown as a bottom tab. */}
        <Tabs.Screen name="validation/[id]" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
