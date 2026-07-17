import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: "#00A859",
                tabBarInactiveTintColor: "#718095",
                tabBarStyle: {
                    height: 66,
                    paddingTop: 7,
                    paddingBottom: 8,
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
        </Tabs>
    );
}
