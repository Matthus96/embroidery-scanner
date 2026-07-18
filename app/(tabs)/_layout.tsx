import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
    const insets = useSafeAreaInsets();
    const bottomInset = Math.max(insets.bottom, 8);

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: "#00A859",
                tabBarInactiveTintColor: "#718095",
                tabBarStyle: {
                    height: 58 + bottomInset,
                    paddingTop: 7,
                    paddingBottom: bottomInset,
                    backgroundColor: "#FFFFFF",
                    borderTopColor: "#DCE3EB",
                },
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: "800",
                },
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: "Connect",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons
                            name="wifi-outline"
                            size={size}
                            color={color}
                        />
                    ),
                }}
            />

            <Tabs.Screen
                name="explore"
                options={{
                    title: "Scan",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons
                            name="scan-outline"
                            size={size}
                            color={color}
                        />
                    ),
                }}
            />

            <Tabs.Screen
                name="operator"
                options={{
                    title: "Operator",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons
                            name="speedometer-outline"
                            size={size}
                            color={color}
                        />
                    ),
                }}
            />

            <Tabs.Screen
                name="cleaner"
                options={{
                    title: "Cleaner",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons
                            name="sparkles-outline"
                            size={size}
                            color={color}
                        />
                    ),
                }}
            />
        </Tabs>
    );
}
