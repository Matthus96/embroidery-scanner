import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    checkPlannerHealth,
    clearPlannerConnection,
    loadPlannerConnection,
    normalizeApiUrl,
    parsePairingCode,
    savePlannerConnection,
    type PlannerHealth,
} from "@/lib/plannerConnection";

export default function ConnectionScreen() {
    const [apiUrl, setApiUrl] = useState("");
    const [token, setToken] = useState("");
    const [pairingCode, setPairingCode] = useState("");
    const [health, setHealth] = useState<PlannerHealth | null>(null);
    const [showToken, setShowToken] = useState(false);
    const [isLoadingSaved, setIsLoadingSaved] = useState(true);
    const [isTesting, setIsTesting] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        async function loadSavedConnection() {
            try {
                const saved = await loadPlannerConnection();

                if (!active || !saved) {
                    return;
                }

                setApiUrl(saved.apiUrl);
                setToken(saved.token);
            } catch (loadError) {
                if (active) {
                    setError(
                        loadError instanceof Error
                            ? loadError.message
                            : String(loadError),
                    );
                }
            } finally {
                if (active) {
                    setIsLoadingSaved(false);
                }
            }
        }

        void loadSavedConnection();

        return () => {
            active = false;
        };
    }, []);

    const connectionReady = Boolean(
        health?.success && health.databaseReady,
    );

    const statusLabel = useMemo(() => {
        if (isTesting) {
            return "Testing";
        }

        if (connectionReady) {
            return "Connected";
        }

        return "Not tested";
    }, [connectionReady, isTesting]);

    function applyPairingCode() {
        setError("");
        setMessage("");
        setHealth(null);

        try {
            const connection = parsePairingCode(pairingCode);

            setApiUrl(connection.apiUrl);
            setToken(connection.token);
            setPairingCode("");
            setMessage(
                "Pairing details loaded. Tap Test and Save Connection.",
            );
        } catch (parseError) {
            setError(
                parseError instanceof Error
                    ? parseError.message
                    : String(parseError),
            );
        }
    }

    async function testAndSaveConnection() {
        setIsTesting(true);
        setError("");
        setMessage("");
        setHealth(null);

        try {
            const connection = {
                apiUrl: normalizeApiUrl(apiUrl),
                token: token.trim(),
            };

            const nextHealth = await checkPlannerHealth(
                connection.apiUrl,
            );

            await savePlannerConnection(connection);

            setApiUrl(connection.apiUrl);
            setToken(connection.token);
            setHealth(nextHealth);
            setMessage(
                "Planner connection saved securely on this device.",
            );
        } catch (testError) {
            setError(
                testError instanceof Error
                    ? testError.message
                    : String(testError),
            );
        } finally {
            setIsTesting(false);
        }
    }

    function confirmClearConnection() {
        Alert.alert(
            "Clear scanner connection?",
            "The saved planner address and pairing token will be removed from this device.",
            [
                {
                    text: "Cancel",
                    style: "cancel",
                },
                {
                    text: "Clear",
                    style: "destructive",
                    onPress: () => {
                        void clearConnection();
                    },
                },
            ],
        );
    }

    async function clearConnection() {
        setError("");
        setMessage("");

        try {
            await clearPlannerConnection();
            setApiUrl("");
            setToken("");
            setPairingCode("");
            setHealth(null);
            setMessage("Saved scanner connection cleared.");
        } catch (clearError) {
            setError(
                clearError instanceof Error
                    ? clearError.message
                    : String(clearError),
            );
        }
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={
                    Platform.OS === "ios" ? "padding" : undefined
                }
            >
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.hero}>
                        <View style={styles.heroIcon}>
                            <Ionicons
                                name="wifi"
                                size={28}
                                color="#FFFFFF"
                            />
                        </View>

                        <View style={styles.heroCopy}>
                            <Text style={styles.eyebrow}>
                                MOBILE OCR SCANNER
                            </Text>
                            <Text style={styles.title}>
                                Connect to the production planner.
                            </Text>
                            <Text style={styles.subtitle}>
                                Keep this phone and the planner computer on
                                the same Wi-Fi network.
                            </Text>
                        </View>
                    </View>

                    <View style={styles.statusCard}>
                        <View
                            style={[
                                styles.statusDot,
                                connectionReady &&
                                    styles.statusDotConnected,
                                isTesting && styles.statusDotTesting,
                            ]}
                        />

                        <View style={styles.statusCopy}>
                            <Text style={styles.statusTitle}>
                                {statusLabel}
                            </Text>
                            <Text style={styles.statusText}>
                                {connectionReady
                                    ? `${health?.referenceCount.toLocaleString()} MB references ready`
                                    : "Paste the pairing code from Planner Settings."}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.sectionEyebrow}>
                            QUICKEST METHOD
                        </Text>
                        <Text style={styles.sectionTitle}>
                            Paste the pairing code
                        </Text>
                        <Text style={styles.sectionDescription}>
                            In the desktop planner, open Settings and select
                            Copy pairing code. Paste the complete code below.
                        </Text>

                        <TextInput
                            value={pairingCode}
                            onChangeText={setPairingCode}
                            placeholder='{"version":1,"apiUrl":"http://...","token":"..."}'
                            placeholderTextColor="#8A96A8"
                            multiline
                            autoCapitalize="none"
                            autoCorrect={false}
                            textAlignVertical="top"
                            style={styles.pairingInput}
                        />

                        <Pressable
                            onPress={applyPairingCode}
                            disabled={!pairingCode.trim()}
                            style={({ pressed }) => [
                                styles.secondaryButton,
                                !pairingCode.trim() &&
                                    styles.buttonDisabled,
                                pressed && styles.buttonPressed,
                            ]}
                        >
                            <Ionicons
                                name="clipboard-outline"
                                size={18}
                                color="#122238"
                            />
                            <Text style={styles.secondaryButtonText}>
                                Apply Pairing Code
                            </Text>
                        </Pressable>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.sectionEyebrow}>
                            CONNECTION DETAILS
                        </Text>
                        <Text style={styles.sectionTitle}>
                            Review before saving
                        </Text>

                        <Text style={styles.inputLabel}>
                            Planner API address
                        </Text>
                        <TextInput
                            value={apiUrl}
                            onChangeText={(value) => {
                                setApiUrl(value);
                                setHealth(null);
                            }}
                            placeholder="http://192.168.6.51:47831"
                            placeholderTextColor="#8A96A8"
                            keyboardType="url"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.input}
                        />

                        <Text style={styles.inputLabel}>
                            Pairing token
                        </Text>
                        <View style={styles.tokenRow}>
                            <TextInput
                                value={token}
                                onChangeText={(value) => {
                                    setToken(value);
                                    setHealth(null);
                                }}
                                placeholder="Paste the rotated token"
                                placeholderTextColor="#8A96A8"
                                secureTextEntry={!showToken}
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={styles.tokenInput}
                            />

                            <Pressable
                                onPress={() =>
                                    setShowToken(
                                        (current) => !current,
                                    )
                                }
                                style={styles.showTokenButton}
                            >
                                <Ionicons
                                    name={
                                        showToken
                                            ? "eye-off-outline"
                                            : "eye-outline"
                                    }
                                    size={21}
                                    color="#45546A"
                                />
                            </Pressable>
                        </View>

                        <Pressable
                            onPress={() =>
                                void testAndSaveConnection()
                            }
                            disabled={
                                isTesting ||
                                isLoadingSaved ||
                                !apiUrl.trim() ||
                                !token.trim()
                            }
                            style={({ pressed }) => [
                                styles.primaryButton,
                                (isTesting ||
                                    isLoadingSaved ||
                                    !apiUrl.trim() ||
                                    !token.trim()) &&
                                    styles.buttonDisabled,
                                pressed && styles.buttonPressed,
                            ]}
                        >
                            {isTesting ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Ionicons
                                    name="shield-checkmark-outline"
                                    size={19}
                                    color="#FFFFFF"
                                />
                            )}

                            <Text style={styles.primaryButtonText}>
                                {isTesting
                                    ? "Testing Connection…"
                                    : "Test and Save Connection"}
                            </Text>
                        </Pressable>

                        {(apiUrl || token) && (
                            <Pressable
                                onPress={confirmClearConnection}
                                style={({ pressed }) => [
                                    styles.clearButton,
                                    pressed && styles.buttonPressed,
                                ]}
                            >
                                <Text style={styles.clearButtonText}>
                                    Clear Saved Connection
                                </Text>
                            </Pressable>
                        )}
                    </View>

                    {message ? (
                        <View style={styles.successMessage}>
                            <Ionicons
                                name="checkmark-circle"
                                size={20}
                                color="#057043"
                            />
                            <Text style={styles.successMessageText}>
                                {message}
                            </Text>
                        </View>
                    ) : null}

                    {error ? (
                        <View style={styles.errorMessage}>
                            <Ionicons
                                name="alert-circle"
                                size={20}
                                color="#A21E2B"
                            />
                            <Text style={styles.errorMessageText}>
                                {error}
                            </Text>
                        </View>
                    ) : null}

                    <Text style={styles.securityNote}>
                        The pairing token is stored with Expo SecureStore and
                        is not displayed unless you choose to reveal it.
                    </Text>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
        backgroundColor: "#EEF2F6",
    },
    content: {
        padding: 18,
        paddingBottom: 40,
        gap: 14,
    },
    hero: {
        flexDirection: "row",
        gap: 15,
        padding: 20,
        backgroundColor: "#122238",
        borderRadius: 18,
        shadowColor: "#122238",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
        elevation: 5,
    },
    heroIcon: {
        width: 52,
        height: 52,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#00A859",
        borderRadius: 15,
    },
    heroCopy: {
        flex: 1,
    },
    eyebrow: {
        marginBottom: 5,
        color: "#56D996",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 1.2,
    },
    title: {
        color: "#FFFFFF",
        fontSize: 23,
        fontWeight: "900",
        lineHeight: 29,
    },
    subtitle: {
        marginTop: 7,
        color: "#BFCADE",
        fontSize: 12,
        lineHeight: 18,
    },
    statusCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 15,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#DCE3EB",
        borderRadius: 14,
    },
    statusDot: {
        width: 11,
        height: 11,
        backgroundColor: "#8A96A8",
        borderRadius: 999,
    },
    statusDotConnected: {
        backgroundColor: "#00A859",
    },
    statusDotTesting: {
        backgroundColor: "#E7A400",
    },
    statusCopy: {
        flex: 1,
    },
    statusTitle: {
        color: "#172033",
        fontSize: 14,
        fontWeight: "900",
    },
    statusText: {
        marginTop: 3,
        color: "#718095",
        fontSize: 11,
    },
    card: {
        padding: 18,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#DCE3EB",
        borderRadius: 16,
        shadowColor: "#122238",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.04,
        shadowRadius: 10,
        elevation: 2,
    },
    sectionEyebrow: {
        color: "#008F4C",
        fontSize: 9,
        fontWeight: "900",
        letterSpacing: 1.1,
    },
    sectionTitle: {
        marginTop: 5,
        color: "#172033",
        fontSize: 19,
        fontWeight: "900",
    },
    sectionDescription: {
        marginTop: 7,
        marginBottom: 14,
        color: "#718095",
        fontSize: 12,
        lineHeight: 18,
    },
    pairingInput: {
        minHeight: 110,
        padding: 13,
        color: "#172033",
        backgroundColor: "#F7F9FB",
        borderWidth: 1,
        borderColor: "#CFD7E1",
        borderRadius: 11,
        fontSize: 12,
        lineHeight: 18,
    },
    inputLabel: {
        marginTop: 15,
        marginBottom: 7,
        color: "#45546A",
        fontSize: 11,
        fontWeight: "900",
    },
    input: {
        height: 49,
        paddingHorizontal: 13,
        color: "#172033",
        backgroundColor: "#F7F9FB",
        borderWidth: 1,
        borderColor: "#CFD7E1",
        borderRadius: 11,
        fontSize: 13,
    },
    tokenRow: {
        flexDirection: "row",
        alignItems: "stretch",
    },
    tokenInput: {
        flex: 1,
        height: 49,
        paddingHorizontal: 13,
        color: "#172033",
        backgroundColor: "#F7F9FB",
        borderWidth: 1,
        borderRightWidth: 0,
        borderColor: "#CFD7E1",
        borderTopLeftRadius: 11,
        borderBottomLeftRadius: 11,
        fontSize: 13,
    },
    showTokenButton: {
        width: 51,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EEF2F6",
        borderWidth: 1,
        borderColor: "#CFD7E1",
        borderTopRightRadius: 11,
        borderBottomRightRadius: 11,
    },
    primaryButton: {
        minHeight: 52,
        marginTop: 18,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        backgroundColor: "#00A859",
        borderRadius: 11,
    },
    primaryButtonText: {
        color: "#FFFFFF",
        fontSize: 13,
        fontWeight: "900",
    },
    secondaryButton: {
        minHeight: 48,
        marginTop: 13,
        paddingHorizontal: 15,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: "#EEF2F6",
        borderWidth: 1,
        borderColor: "#D7DEE7",
        borderRadius: 11,
    },
    secondaryButtonText: {
        color: "#122238",
        fontSize: 12,
        fontWeight: "900",
    },
    clearButton: {
        minHeight: 44,
        marginTop: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    clearButtonText: {
        color: "#A21E2B",
        fontSize: 11,
        fontWeight: "900",
    },
    buttonDisabled: {
        opacity: 0.45,
    },
    buttonPressed: {
        opacity: 0.76,
    },
    successMessage: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 9,
        padding: 14,
        backgroundColor: "#E1F7EC",
        borderWidth: 1,
        borderColor: "#A9DFC3",
        borderRadius: 12,
    },
    successMessageText: {
        flex: 1,
        color: "#057043",
        fontSize: 12,
        fontWeight: "800",
        lineHeight: 18,
    },
    errorMessage: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 9,
        padding: 14,
        backgroundColor: "#FFF0F1",
        borderWidth: 1,
        borderColor: "#EFB9BF",
        borderRadius: 12,
    },
    errorMessageText: {
        flex: 1,
        color: "#A21E2B",
        fontSize: 12,
        fontWeight: "800",
        lineHeight: 18,
    },
    securityNote: {
        paddingHorizontal: 12,
        color: "#7A8798",
        fontSize: 10,
        lineHeight: 16,
        textAlign: "center",
    },
});
