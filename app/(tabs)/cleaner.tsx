import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { parseDaysheetText } from "../../lib/daysheetParser";
import { finishCleanerOrder, loadCleanerOrder, type CleanerOrder } from "../../lib/plannerApi";

const CLEANER_KEY = "embroidery-scanner.cleaner-name";
const CLEANING_WARNING_SECONDS = 30 * 60;

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const remainder = (safe % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function timestampMilliseconds(value: string | null) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const milliseconds = new Date(normalized).getTime();
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

export default function CleanerScreen() {
  const camera = useRef<CameraView | null>(null);
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [cleanerName, setCleanerName] = useState("");
  const [daysheet, setDaysheet] = useState("");
  const [rawOcrText, setRawOcrText] = useState("");
  const [note, setNote] = useState("");
  const [order, setOrder] = useState<CleanerOrder | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void SecureStore.getItemAsync(CLEANER_KEY).then((value) => value && setCleanerName(value));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startedAt = timestampMilliseconds(order?.startedAt ?? null);
  const elapsedSeconds = startedAt === null ? 0 : Math.max((now - startedAt) / 1000, 0);
  const longRunning = elapsedSeconds >= CLEANING_WARNING_SECONDS;

  async function openCamera() {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setShowCamera(true);
  }

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true); setError("");
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.88 });
      if (!photo?.uri) throw new Error("The camera did not return an image.");
      const recognized = await recognizeText(photo.uri);
      const text = recognized.text.trim();
      const parsed = parseDaysheetText(text);
      if (!parsed.daysheetNumber) throw new Error("No D/S number was detected. Try again or enter it manually.");
      setDaysheet(parsed.daysheetNumber); setRawOcrText(text); setShowCamera(false);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally { setBusy(false); }
  }

  async function load() {
    if (!daysheet.trim()) return setError("Scan or enter the D/S number.");
    setBusy(true); setError("");
    try {
      await SecureStore.setItemAsync(CLEANER_KEY, cleanerName.trim());
      const loaded = await loadCleanerOrder({ daysheetNumber: daysheet.trim(), cleanerName: cleanerName.trim(), rawOcrText });
      setOrder(loaded); setDaysheet(""); setRawOcrText("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally { setBusy(false); }
  }

  async function finish() {
    if (!order) return;
    setBusy(true); setError("");
    try {
      const completed = await finishCleanerOrder(order.cleaningOrderId, { cleanerName: cleanerName.trim(), note: note.trim() });
      Alert.alert("Added to production history", `${completed.daysheetNumber} was completed for the current shift.`);
      setOrder(null); setNote("");
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : String(finishError));
    } finally { setBusy(false); }
  }

  if (showCamera) return <View style={styles.cameraPage}>
    {focused && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />}
    <View style={styles.guide}><Text style={styles.guideText}>Keep the D/S number inside the frame</Text></View>
    <View style={[styles.cameraActions, { bottom: Math.max(insets.bottom, 20) + 20 }]}>
      <Pressable style={styles.secondary} onPress={() => setShowCamera(false)}><Text>Cancel</Text></Pressable>
      <Pressable style={styles.primary} onPress={() => void capture()}><Text style={styles.primaryText}>{busy ? "Reading…" : "Capture"}</Text></Pressable>
    </View>
  </View>;

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>FINISHING DEPARTMENT</Text>
    <Text style={styles.title}>Thread cleaning</Text>
    <Text style={styles.help}>Scan orders received from embroidery machines. Mark Finished only after thread cleaning and badge touch-ups are complete.</Text>
    <Text style={styles.label}>Cleaner name</Text>
    <TextInput style={styles.input} value={cleanerName} onChangeText={setCleanerName} placeholder="Cleaner or team name" />
    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

    {!order ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Receive order for cleaning</Text>
      <TextInput style={styles.input} value={daysheet} onChangeText={setDaysheet} autoCapitalize="characters" placeholder="D/S number" />
      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={() => void openCamera()}><Text>Scan D/S</Text></Pressable>
        <Pressable style={styles.primary} onPress={() => void load()} disabled={busy}><Text style={styles.primaryText}>{busy ? "Loading…" : "Start cleaning"}</Text></Pressable>
      </View>
    </View> : <View style={styles.card}>
      <View style={styles.statusRow}><Text style={styles.cardTitle}>{order.machineName}</Text><Text style={[styles.status, longRunning && styles.statusWarning]}>{longRunning ? "ATTENTION" : "CLEANING"}</Text></View>
      <Text style={styles.daysheet}>{order.daysheetNumber}</Text>
      <Text style={styles.customer}>{order.customer}</Text>
      <Text style={styles.details}>{order.garmentType || "Production order"}</Text>
      <View style={styles.summary}>
        <View><Text style={styles.summaryLabel}>Badge</Text><Text style={styles.summaryValue}>{order.mbNumber || "—"}</Text></View>
        <View><Text style={styles.summaryLabel}>Units</Text><Text style={styles.summaryValue}>{order.units}</Text></View>
        <View><Text style={styles.summaryLabel}>Runs</Text><Text style={styles.summaryValue}>{order.runs}</Text></View>
      </View>
      <View style={[styles.cleaningTimer, longRunning && styles.cleaningTimerWarning]}>
        <Text style={styles.timerLabel}>{longRunning ? "LONG-RUNNING CLEAN" : "CLEANING TIME"}</Text>
        <Text style={[styles.timerValue, longRunning && styles.timerValueWarning]}>{clock(elapsedSeconds)}</Text>
        <Text style={styles.timerHelp}>{longRunning ? "This order has exceeded the 30-minute cleaning threshold." : "Timer started when this order was scanned into cleaning."}</Text>
      </View>
      <Text style={styles.label}>Completion note (optional)</Text>
      <TextInput style={[styles.input, styles.note]} value={note} onChangeText={setNote} multiline placeholder="Touch-ups, rejects, or remarks" />
      <Pressable style={styles.finish} onPress={() => void finish()} disabled={busy}><Text style={styles.primaryText}>{busy ? "Finishing…" : "Finished — add to history"}</Text></Pressable>
      <Pressable style={styles.cancelOrder} onPress={() => { setOrder(null); setNote(""); }} disabled={busy}><Text>Close without finishing</Text></Pressable>
      {busy && <ActivityIndicator color="#008F4C" />}
    </View>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6F9" }, page: { padding: 20, paddingBottom: 100, gap: 12 }, eyebrow: { color: "#008848", fontWeight: "900", letterSpacing: 1.3 }, title: { fontSize: 30, fontWeight: "900", color: "#17212B" }, help: { color: "#667385", lineHeight: 21 }, label: { fontWeight: "800", color: "#344252" }, input: { backgroundColor: "white", borderWidth: 1, borderColor: "#D5DEE7", borderRadius: 12, padding: 13, fontSize: 16 }, note: { minHeight: 88, textAlignVertical: "top" }, card: { backgroundColor: "white", borderRadius: 18, padding: 17, gap: 13, elevation: 2 }, cardTitle: { fontSize: 19, fontWeight: "900", color: "#17212B" }, row: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, primary: { backgroundColor: "#008F4C", padding: 14, borderRadius: 12, alignItems: "center", flexGrow: 1 }, secondary: { backgroundColor: "#E7EDF3", padding: 14, borderRadius: 12, alignItems: "center" }, primaryText: { color: "white", fontWeight: "900" }, finish: { backgroundColor: "#087C46", padding: 16, borderRadius: 12, alignItems: "center" }, cancelOrder: { padding: 12, alignItems: "center" }, statusRow: { flexDirection: "row", justifyContent: "space-between" }, status: { color: "#087C46", fontWeight: "900" }, statusWarning: { color: "#B12636" }, daysheet: { fontSize: 26, fontWeight: "900", color: "#17212B" }, customer: { fontSize: 18, fontWeight: "800", color: "#25364A" }, details: { color: "#667385" }, summary: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#F4F7F9", padding: 14, borderRadius: 12 }, summaryLabel: { color: "#728092", fontSize: 11, fontWeight: "800" }, summaryValue: { color: "#17212B", fontSize: 17, fontWeight: "900" }, cleaningTimer: { padding: 18, alignItems: "center", backgroundColor: "#EAF8F1", borderWidth: 1, borderColor: "#B9E3CD", borderRadius: 14 }, cleaningTimerWarning: { backgroundColor: "#FFF1F2", borderColor: "#E9A9B1" }, timerLabel: { color: "#567365", fontSize: 11, fontWeight: "900", letterSpacing: 1 }, timerValue: { marginTop: 5, color: "#087C46", fontSize: 36, lineHeight: 43, fontWeight: "900", fontVariant: ["tabular-nums"] }, timerValueWarning: { color: "#B12636" }, timerHelp: { marginTop: 4, color: "#728092", fontSize: 11, lineHeight: 16, textAlign: "center" }, error: { backgroundColor: "#FDE8E7", padding: 12, borderRadius: 10 }, errorText: { color: "#A72E2A", fontWeight: "700" }, cameraPage: { flex: 1, backgroundColor: "black" }, guide: { position: "absolute", top: "38%", left: 24, right: 24, height: 120, borderWidth: 2, borderColor: "#52E697", borderRadius: 12 }, guideText: { color: "white", backgroundColor: "rgba(0,0,0,.7)", padding: 8, alignSelf: "center" }, cameraActions: { position: "absolute", left: 24, right: 24, flexDirection: "row", justifyContent: "space-between" },
});
