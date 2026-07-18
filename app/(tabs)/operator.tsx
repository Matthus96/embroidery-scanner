import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { parseDaysheetText } from "../../lib/daysheetParser";
import {
  getMachineSession,
  getOperatorMachines,
  loadOperatorOrder,
  updateOperatorSession,
  type OperatorAction,
  type OperatorMachine,
  type OperatorSession,
} from "../../lib/plannerApi";

const MACHINE_KEY = "embroidery-scanner.operator-machine";
const OPERATOR_KEY = "embroidery-scanner.operator-name";
const PAUSE_REASONS = [
  "Thread break", "Bobbin change", "Needle break", "Garment loading",
  "Design/setup adjustment", "Quality check", "Machine fault",
  "Waiting for material", "Operator break", "Other",
];

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const remainder = (safe % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function EtaGauge({ elapsedSeconds, estimatedSeconds, completed }: {
  elapsedSeconds: number;
  estimatedSeconds: number | null;
  completed: boolean;
}) {
  const size = 190;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const elapsedRatio = estimatedSeconds && estimatedSeconds > 0
    ? Math.max(elapsedSeconds / estimatedSeconds, 0)
    : 0;
  const ringRatio = Math.min(elapsedRatio, 1);
  const remaining = estimatedSeconds === null ? null : estimatedSeconds - elapsedSeconds;
  const tone = estimatedSeconds !== null && elapsedRatio >= 1
    ? "overtime"
    : estimatedSeconds !== null && elapsedRatio >= 0.9
      ? "warning"
      : completed
        ? "completed"
        : "normal";
  const color = tone === "overtime" ? "#DC3545" : tone === "warning" ? "#E7A400" : "#00A859";

  return <View style={styles.gauge}>
    <Svg width={size} height={size} style={styles.gaugeSvg}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#E8EDF1" strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - ringRatio)}
      />
    </Svg>
    <View style={styles.gaugeCopy}>
      <Text style={styles.gaugeLabel}>{remaining !== null && remaining <= 0 ? "OVER ETA" : "ETA"}</Text>
      <Text style={[styles.gaugeTime, { color }]}>{remaining === null ? "--:--:--" : clock(Math.abs(remaining))}</Text>
      <Text style={styles.gaugePercent}>{Math.round(elapsedRatio * 100)}%</Text>
    </View>
  </View>;
}

export default function OperatorScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView | null>(null);
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [machines, setMachines] = useState<OperatorMachine[]>([]);
  const [machineId, setMachineId] = useState<number | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [daysheet, setDaysheet] = useState("");
  const [rawOcrText, setRawOcrText] = useState("");
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [sessionSyncedAt, setSessionSyncedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [showCamera, setShowCamera] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseNote, setPauseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    void Promise.all([
      SecureStore.getItemAsync(MACHINE_KEY),
      SecureStore.getItemAsync(OPERATOR_KEY),
    ]).then(([savedMachine, savedOperator]) => {
      const parsed = Number(savedMachine);
      if (Number.isInteger(parsed) && parsed > 0) setMachineId(parsed);
      if (savedOperator) setOperatorName(savedOperator);
    });
  }, []);

  useEffect(() => {
    if (!focused) return;

    let active = true;

    async function reloadOperatorConnection() {
      try {
        const nextMachines = await getOperatorMachines();

        if (!active) return;

        setMachines(nextMachines);
        setError("");

        if (machineId) {
          const nextSession = await getMachineSession(machineId);

          if (active) {
            setSession(nextSession);
            setSessionSyncedAt(Date.now());
          }
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    }

    void reloadOperatorConnection();

    return () => {
      active = false;
    };
  }, [focused, machineId]);

  useEffect(() => {
    if (!machineId || !focused) return;
    const timer = setInterval(() => void getMachineSession(machineId).then((nextSession) => {
      setSession(nextSession);
      setSessionSyncedAt(Date.now());
    }).catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [machineId, focused]);

  async function selectMachine(machine: OperatorMachine) {
    setMachineId(machine.machineId);
    setSession(machine.activeSession);
    setSessionSyncedAt(Date.now());
    setError("");
    await SecureStore.setItemAsync(MACHINE_KEY, String(machine.machineId));
  }

  async function scanDaysheet() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setShowCamera(true);
  }

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError("");
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.88 });
      if (!photo?.uri) throw new Error("The camera did not return an image.");
      const recognized = await recognizeText(photo.uri);
      const text = recognized.text.trim();
      const parsed = parseDaysheetText(text);
      if (!parsed.daysheetNumber) throw new Error("No D/S number was detected. Try again or enter it manually.");
      setDaysheet(parsed.daysheetNumber);
      setRawOcrText(text);
      setShowCamera(false);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setBusy(false);
    }
  }

  async function loadOrder() {
    if (!machineId) return setError("Pair this tablet with a machine first.");
    if (!daysheet.trim()) return setError("Scan or enter the D/S number.");
    setBusy(true);
    setError("");
    try {
      await SecureStore.setItemAsync(OPERATOR_KEY, operatorName.trim());
      const loaded = await loadOperatorOrder({
        daysheetNumber: daysheet.trim(), machineId,
        operatorName: operatorName.trim(), rawOcrText,
      });
      setSession(loaded);
      setSessionSyncedAt(Date.now());
      setDaysheet("");
      setRawOcrText("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setBusy(false);
    }
  }

  async function action(nextAction: OperatorAction) {
    if (!session) return;
    if (nextAction === "pause" && !pauseReason) return setError("Choose a pause reason.");
    if (nextAction === "pause" && pauseReason === "Other" && !pauseNote.trim()) return setError("Enter a note for Other.");
    setBusy(true);
    setError("");
    try {
      const updated = await updateOperatorSession(session.sessionId, {
        action: nextAction,
        reason: nextAction === "pause" ? pauseReason : undefined,
        note: nextAction === "pause" ? pauseNote.trim() : undefined,
        operatorName: operatorName.trim(),
      });
      setSession(updated.status === "completed" ? null : updated);
      setSessionSyncedAt(Date.now());
      setPauseReason("");
      setPauseNote("");
      if (updated.status === "completed") Alert.alert("Sent to cleaning", `${updated.daysheetNumber} is ready for thread cleaning and touch-ups.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  }

  if (showCamera) {
    return <View style={styles.cameraPage}>
      {focused && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />}
      <View style={styles.cameraGuide}><Text style={styles.cameraText}>Keep the D/S number inside the frame</Text></View>
      <View style={[styles.cameraActions, { bottom: Math.max(insets.bottom, 20) + 20 }]}>
        <Pressable style={styles.secondaryButton} onPress={() => setShowCamera(false)}><Text>Cancel</Text></Pressable>
        <Pressable style={styles.captureButton} onPress={() => void capture()} disabled={busy}><Text style={styles.primaryText}>{busy ? "Reading…" : "Capture"}</Text></Pressable>
      </View>
    </View>;
  }

  const selectedMachine = machines.find((machine) => machine.machineId === machineId);
  const liveRunningSeconds = session
    ? session.runningSeconds + (session.status === "running" ? Math.max((now - sessionSyncedAt) / 1000, 0) : 0)
    : 0;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>LIVE PRODUCTION</Text>
    <Text style={styles.title}>Operator control</Text>
    <Text style={styles.help}>Pair this tablet to one machine, scan its assigned order, then control the live Speed Dashboard session.</Text>

    <Text style={styles.label}>Operator name</Text>
    <TextInput style={styles.input} value={operatorName} onChangeText={setOperatorName} placeholder="Operator name" />

    <Text style={styles.label}>Tablet machine</Text>
    <View style={styles.chips}>{machines.map((machine) => <Pressable key={machine.machineId} style={[styles.chip, machineId === machine.machineId && styles.chipActive]} onPress={() => void selectMachine(machine)}><Text style={machineId === machine.machineId ? styles.chipTextActive : styles.chipText}>{machine.machineName}</Text></Pressable>)}</View>
    {selectedMachine && <Text style={styles.connected}>{selectedMachine.machineName} · {selectedMachine.workingHeads} working heads</Text>}

    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

    {!session ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Load assigned order</Text>
      <TextInput style={styles.input} value={daysheet} onChangeText={setDaysheet} autoCapitalize="characters" placeholder="D/S number, e.g. 23-0528-2627" />
      <View style={styles.row}>
        <Pressable style={styles.secondaryButton} onPress={() => void scanDaysheet()}><Text>Scan D/S</Text></Pressable>
        <Pressable style={styles.primaryButton} onPress={() => void loadOrder()} disabled={busy}><Text style={styles.primaryText}>{busy ? "Loading…" : "Load on dashboard"}</Text></Pressable>
      </View>
    </View> : <View style={styles.card}>
      <View style={styles.statusRow}><Text style={styles.cardTitle}>{session.machineName}</Text><Text style={styles.status}>{session.status.toUpperCase()}</Text></View>
      <Text style={styles.daysheet}>{session.daysheetNumber}</Text>
      <Text style={styles.orderText}>{session.customer} {session.garmentType}</Text>
      <Text style={styles.orderText}>{session.mbNumber || "No MB"} · {session.stitchCount?.toLocaleString() ?? "No"} stitches · {session.units} units</Text>
      <EtaGauge
        elapsedSeconds={liveRunningSeconds}
        estimatedSeconds={session.estimatedSeconds}
        completed={session.completedRuns >= session.totalRuns}
      />
      <View style={styles.metrics}>
        <View><Text style={styles.metricLabel}>Runs</Text><Text style={styles.metric}>{session.completedRuns}/{session.totalRuns}</Text></View>
        <View><Text style={styles.metricLabel}>Running</Text><Text style={styles.metric}>{clock(liveRunningSeconds)}</Text></View>
        <View><Text style={styles.metricLabel}>Paused</Text><Text style={styles.metric}>{clock(session.pausedSeconds)}</Text></View>
      </View>
      {session.pauseReason && <Text style={styles.pauseBanner}>PAUSED — {session.pauseReason} · {clock(session.currentPauseSeconds)}</Text>}

      {session.status === "running" && <>
        <Text style={styles.label}>Pause reason</Text>
        <View style={styles.chips}>{PAUSE_REASONS.map((reason) => <Pressable key={reason} style={[styles.chip, pauseReason === reason && styles.chipActive]} onPress={() => setPauseReason(reason)}><Text style={pauseReason === reason ? styles.chipTextActive : styles.chipText}>{reason}</Text></Pressable>)}</View>
        {pauseReason === "Other" && <TextInput style={styles.input} value={pauseNote} onChangeText={setPauseNote} placeholder="Required pause note" />}
      </>}

      <View style={styles.actions}>
        {session.status === "loaded" && <Pressable style={styles.primaryButton} onPress={() => void action("start")}><Text style={styles.primaryText}>Start order</Text></Pressable>}
        {session.status === "running" && <><Pressable style={styles.warningButton} onPress={() => void action("pause")}><Text style={styles.primaryText}>Pause</Text></Pressable><Pressable style={styles.primaryButton} onPress={() => void action("complete-run")}><Text style={styles.primaryText}>Complete run</Text></Pressable></>}
        {(session.status === "paused" || session.status === "between-runs") && <Pressable style={styles.primaryButton} onPress={() => void action("resume")}><Text style={styles.primaryText}>{session.status === "between-runs" ? "Start next run" : "Resume"}</Text></Pressable>}
        {session.completedRuns >= session.totalRuns && <Pressable style={styles.finishButton} onPress={() => void action("finish")}><Text style={styles.primaryText}>Finish order</Text></Pressable>}
      </View>
      {busy && <ActivityIndicator color="#00A859" />}
    </View>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6F9" }, page: { padding: 20, paddingBottom: 100, gap: 12 },
  eyebrow: { color: "#008848", fontWeight: "900", letterSpacing: 1.3 }, title: { fontSize: 30, fontWeight: "900", color: "#17212B" }, help: { color: "#667385", lineHeight: 21 },
  label: { fontWeight: "800", color: "#344252", marginTop: 4 }, input: { backgroundColor: "white", borderWidth: 1, borderColor: "#D5DEE7", borderRadius: 12, padding: 13, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { borderWidth: 1, borderColor: "#CBD5DF", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "white" }, chipActive: { backgroundColor: "#087C46", borderColor: "#087C46" }, chipText: { color: "#344252", fontWeight: "700" }, chipTextActive: { color: "white", fontWeight: "800" }, connected: { color: "#087C46", fontWeight: "700" },
  card: { backgroundColor: "white", borderRadius: 18, padding: 17, gap: 13, shadowColor: "#142331", shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 }, cardTitle: { fontSize: 19, fontWeight: "900", color: "#17212B" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, primaryButton: { backgroundColor: "#008F4C", padding: 14, borderRadius: 12, alignItems: "center", flexGrow: 1 }, secondaryButton: { backgroundColor: "#E7EDF3", padding: 14, borderRadius: 12, alignItems: "center" }, warningButton: { backgroundColor: "#D17800", padding: 14, borderRadius: 12, flexGrow: 1, alignItems: "center" }, finishButton: { backgroundColor: "#174E91", padding: 14, borderRadius: 12, flexGrow: 1, alignItems: "center" }, primaryText: { color: "white", fontWeight: "900" },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, status: { color: "#087C46", fontWeight: "900" }, daysheet: { fontSize: 25, fontWeight: "900", color: "#17212B" }, orderText: { color: "#526171" },
  gauge: { width: 190, height: 190, alignSelf: "center", position: "relative", marginVertical: 4 }, gaugeSvg: { transform: [{ rotate: "-90deg" }] }, gaugeCopy: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 4 }, gaugeLabel: { color: "#758296", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }, gaugeTime: { fontSize: 24, lineHeight: 29, fontWeight: "900", fontVariant: ["tabular-nums"] }, gaugePercent: { color: "#758296", fontSize: 12, fontWeight: "900" },
  metrics: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#F4F7F9", padding: 13, borderRadius: 12 }, metricLabel: { color: "#728092", fontSize: 11, fontWeight: "800" }, metric: { color: "#17212B", fontSize: 17, fontWeight: "900", marginTop: 3 }, pauseBanner: { backgroundColor: "#FFF1D7", color: "#925600", padding: 12, borderRadius: 10, fontWeight: "900" },
  error: { backgroundColor: "#FDE8E7", padding: 12, borderRadius: 10 }, errorText: { color: "#A72E2A", fontWeight: "700" },
  cameraPage: { flex: 1, backgroundColor: "black" }, cameraGuide: { position: "absolute", top: "38%", left: 24, right: 24, height: 120, borderWidth: 2, borderColor: "#52E697", borderRadius: 12, justifyContent: "flex-start" }, cameraText: { color: "white", backgroundColor: "rgba(0,0,0,.7)", padding: 8, alignSelf: "center" }, cameraActions: { position: "absolute", left: 24, right: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, captureButton: { backgroundColor: "#008F4C", paddingVertical: 17, paddingHorizontal: 30, borderRadius: 999 },
});
