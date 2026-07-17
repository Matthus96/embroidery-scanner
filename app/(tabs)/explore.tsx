import { Ionicons } from "@expo/vector-icons";
import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { parseDaysheetText } from "../../lib/daysheetParser";
import {
  lookupMasterOrder,
  submitScannedOrder,
  type MasterOrderLookupResponse,
  type ScanOrderResponse,
} from "../../lib/plannerApi";

type FormState = {
  daysheetNumber: string;
  styleReference: string;
  customer: string;
  quantity: string;
};

const EMPTY_FORM: FormState = {
  daysheetNumber: "",
  styleReference: "",
  customer: "",
  quantity: "",
};

export default function ScannerScreen() {
  const cameraRef = useRef<CameraView | null>(null);
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [photoUri, setPhotoUri] = useState("");
  const [recognizedText, setRecognizedText] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [masterLookup, setMasterLookup] =
    useState<MasterOrderLookupResponse | null>(null);
  const [mbVerifiedByUser, setMbVerifiedByUser] = useState(false);
  const [submission, setSubmission] = useState<ScanOrderResponse | null>(null);
  const [error, setError] = useState("");

  function updateForm(field: keyof FormState, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setMasterLookup(null);
    setMbVerifiedByUser(false);
    setSubmission(null);
    setError("");
  }

  async function captureAndRecognize() {
    if (!cameraRef.current || !isCameraReady || isRecognizing) {
      return;
    }

    setIsRecognizing(true);
    setError("");
    setRecognizedText("");
    setWarnings([]);
    setMasterLookup(null);
    setMbVerifiedByUser(false);
    setSubmission(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        throw new Error("The camera did not return an image.");
      }

      setPhotoUri(photo.uri);

      const result = await recognizeText(photo.uri);
      const text = result.text.trim();

      if (!text) {
        throw new Error(
          "No printed text was recognised. Retake the image in brighter light and keep the daysheet flat.",
        );
      }

      const parsed = parseDaysheetText(text);

      setRecognizedText(text);
      setForm({
        daysheetNumber: parsed.daysheetNumber,
        styleReference: parsed.styleReference,
        customer: parsed.customer,
        quantity: parsed.quantity?.toString() ?? "",
      });
      setWarnings(parsed.warnings);
    } catch (recognitionError) {
      setError(
        recognitionError instanceof Error
          ? recognitionError.message
          : String(recognitionError),
      );
    } finally {
      setIsRecognizing(false);
    }
  }

  function retakePhoto() {
    setPhotoUri("");
    setRecognizedText("");
    setForm(EMPTY_FORM);
    setWarnings([]);
    setMasterLookup(null);
    setMbVerifiedByUser(false);
    setSubmission(null);
    setError("");
    setTorchEnabled(false);
  }

  async function shareRecognizedText() {
    if (!recognizedText) {
      return;
    }

    await Share.share({
      title: "Daysheet OCR text",
      message: recognizedText,
    });
  }

  async function checkMasterRecord() {
    setError("");
    setMasterLookup(null);
    setMbVerifiedByUser(false);
    setSubmission(null);

    const quantity = Number(form.quantity);

    if (!/^\d{2}-\d{4}-\d{4}$/.test(form.daysheetNumber.trim())) {
      setError("Check the D/S number. Expected format: 23-0528-2627.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Enter a valid Total / Units value before checking the master.");
      return;
    }

    setIsLookingUp(true);

    try {
      const response = await lookupMasterOrder({
        daysheetNumber: form.daysheetNumber.trim(),
        quantity,
        rawOcrText: recognizedText,
      });

      setMasterLookup(response);
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : String(lookupError),
      );
    } finally {
      setIsLookingUp(false);
    }
  }

  async function uploadOrder() {
    setError("");
    setSubmission(null);

    const quantity = Number(form.quantity);

    if (!/^\d{2}-\d{4}-\d{4}$/.test(form.daysheetNumber.trim())) {
      setError("Check the D/S number. Expected format: 23-0528-2627.");
      return;
    }

    if (!form.styleReference.trim()) {
      setError("Enter the printed Range / style reference.");
      return;
    }

    if (!form.customer.trim()) {
      setError("Enter the garment description.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Enter a valid Total / Units value.");
      return;
    }

    if (!masterLookup) {
      setError("Check this D/S against the imported master before uploading.");
      return;
    }

    if (
      masterLookup.daysheetNumber !== form.daysheetNumber.trim() ||
      masterLookup.quantity !== quantity
    ) {
      setMasterLookup(null);
      setMbVerifiedByUser(false);
      setError("The D/S or quantity changed. Check the master again.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await submitScannedOrder({
        daysheetNumber: form.daysheetNumber.trim(),
        styleReference: form.styleReference.trim().toUpperCase(),
        customer: form.customer.trim(),
        quantity,
        rawOcrText: recognizedText,
        sourceImageUri: photoUri,
        verifiedMbNumber: mbVerifiedByUser ? masterLookup.mbNumber : undefined,
      });

      setSubmission(response);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#00A859" />
          <Text style={styles.stateText}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.permissionCard}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={38} color="#FFFFFF" />
          </View>

          <Text style={styles.eyebrow}>CAMERA ACCESS</Text>
          <Text style={styles.permissionTitle}>
            Photograph printed daysheets.
          </Text>
          <Text style={styles.permissionDescription}>
            Camera access is required so the scanner can read the Range,
            Description, Total and D/S number using OCR.
          </Text>

          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              void requestPermission();
            }}
          >
            <Ionicons name="camera" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Allow camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (photoUri) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.resultContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultHeader}>
              <View>
                <Text style={styles.eyebrow}>OCR RESULT</Text>
                <Text style={styles.resultTitle}>
                  Confirm the daysheet fields.
                </Text>
              </View>

              <Pressable style={styles.iconButton} onPress={retakePhoto}>
                <Ionicons name="refresh" size={21} color="#172033" />
              </Pressable>
            </View>

            <Image
              source={{ uri: photoUri }}
              style={styles.previewImage}
              resizeMode="cover"
            />

            {isRecognizing ? (
              <View style={styles.processingCard}>
                <ActivityIndicator size="large" color="#00A859" />
                <Text style={styles.processingTitle}>Reading daysheet…</Text>
                <Text style={styles.processingText}>
                  ML Kit is recognising the printed text on this device.
                </Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={21}
                  color="#B12636"
                />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {submission ? (
              <View style={styles.successCard}>
                <Ionicons name="checkmark-circle" size={28} color="#00763F" />
                <View style={styles.successCopy}>
                  <Text style={styles.successTitle}>
                    Order added to the planner
                  </Text>
                  <Text style={styles.successText}>{submission.message}</Text>
                  <Text style={styles.successMeta}>
                    {submission.mbNumber
                      ? `${submission.mbNumber} · ${submission.stitchCount?.toLocaleString() ?? "No"} stitches`
                      : `No badge MB · Waiting for review`}
                  </Text>
                  {submission.assignedMachineName ? (
                    <Text style={styles.successMeta}>
                      Assigned to {submission.assignedMachineName}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {recognizedText ? (
              <View style={styles.formCard}>
                <View style={styles.cardHeading}>
                  <View>
                    <Text style={styles.sectionEyebrow}>DETECTED FIELDS</Text>
                    <Text style={styles.sectionTitle}>
                      Review before uploading
                    </Text>
                  </View>

                  <View style={styles.successBadge}>
                    <Ionicons name="scan" size={15} color="#00763F" />
                    <Text style={styles.successBadgeText}>OCR</Text>
                  </View>
                </View>

                <Text style={styles.inputLabel}>D/S number</Text>
                <TextInput
                  value={form.daysheetNumber}
                  onChangeText={(value) => updateForm("daysheetNumber", value)}
                  placeholder="23-0528-2627"
                  placeholderTextColor="#8A96A8"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Range / style reference</Text>
                <TextInput
                  value={form.styleReference}
                  onChangeText={(value) => updateForm("styleReference", value)}
                  placeholder="MB7754"
                  placeholderTextColor="#8A96A8"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Description</Text>
                <TextInput
                  value={form.customer}
                  onChangeText={(value) => updateForm("customer", value)}
                  placeholder="ZEERUST COMB. GIRL S/S BLOUSE"
                  placeholderTextColor="#8A96A8"
                  autoCapitalize="characters"
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Total / units</Text>
                <TextInput
                  value={form.quantity}
                  onChangeText={(value) =>
                    updateForm("quantity", value.replace(/\D/g, ""))
                  }
                  placeholder="79"
                  placeholderTextColor="#8A96A8"
                  keyboardType="number-pad"
                  style={styles.input}
                />

                {warnings.length ? (
                  <View style={styles.warningCard}>
                    <Ionicons
                      name="warning-outline"
                      size={19}
                      color="#8B5F00"
                    />
                    <View style={styles.warningCopy}>
                      {warnings.map((warning) => (
                        <Text key={warning} style={styles.warningText}>
                          {warning}
                        </Text>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={styles.detectedCard}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={19}
                      color="#00763F"
                    />
                    <Text style={styles.detectedText}>
                      All four OCR fields were detected. The badge MB will come
                      only from the imported master.
                    </Text>
                  </View>
                )}

                {!masterLookup ? (
                  <Pressable
                    style={[
                      styles.masterLookupButton,
                      isLookingUp && styles.disabledButton,
                    ]}
                    disabled={isLookingUp}
                    onPress={() => {
                      void checkMasterRecord();
                    }}
                  >
                    {isLookingUp ? (
                      <ActivityIndicator size="small" color="#172033" />
                    ) : (
                      <Ionicons
                        name="search-outline"
                        size={19}
                        color="#172033"
                      />
                    )}
                    <Text style={styles.masterLookupButtonText}>
                      {isLookingUp ? "Checking master…" : "Check Master Record"}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.masterCard}>
                    <View style={styles.masterCardHeader}>
                      <View style={styles.masterIcon}>
                        <Ionicons
                          name="server-outline"
                          size={20}
                          color="#FFFFFF"
                        />
                      </View>
                      <View style={styles.masterHeaderCopy}>
                        <Text style={styles.masterEyebrow}>
                          MASTER MATCH FOUND
                        </Text>
                        <Text style={styles.masterMb}>
                          {masterLookup.mbNumber}
                        </Text>
                      </View>
                      <View style={styles.masterLockedBadge}>
                        <Ionicons
                          name="lock-closed"
                          size={12}
                          color="#176B48"
                        />
                        <Text style={styles.masterLockedText}>MASTER</Text>
                      </View>
                    </View>

                    <View style={styles.masterDetails}>
                      <View style={styles.masterDetailRow}>
                        <Text style={styles.masterDetailLabel}>Customer</Text>
                        <Text style={styles.masterDetailValue}>
                          {masterLookup.customer}
                        </Text>
                      </View>
                      <View style={styles.masterDetailRow}>
                        <Text style={styles.masterDetailLabel}>Units</Text>
                        <Text style={styles.masterDetailValue}>
                          {masterLookup.quantity}
                        </Text>
                      </View>
                      <View style={styles.masterDetailRow}>
                        <Text style={styles.masterDetailLabel}>Stitches</Text>
                        <Text style={styles.masterDetailValue}>
                          {masterLookup.stitchCount?.toLocaleString() ??
                            "Not available"}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.ocrVerification,
                        masterLookup.ocrMbDetected
                          ? styles.ocrVerificationMatched
                          : styles.ocrVerificationUnseen,
                      ]}
                    >
                      <Ionicons
                        name={
                          masterLookup.ocrMbDetected
                            ? "checkmark-circle"
                            : "eye-off-outline"
                        }
                        size={18}
                        color={
                          masterLookup.ocrMbDetected ? "#00763F" : "#725300"
                        }
                      />
                      <Text
                        style={[
                          styles.ocrVerificationText,
                          masterLookup.ocrMbDetected
                            ? styles.ocrVerificationTextMatched
                            : styles.ocrVerificationTextUnseen,
                        ]}
                      >
                        {masterLookup.ocrMbDetected
                          ? `OCR also detected ${masterLookup.mbNumber}.`
                          : `${masterLookup.mbNumber} was not detected in the OCR text.`}
                      </Text>
                    </View>

                    <Pressable
                      style={[
                        styles.verifyRow,
                        mbVerifiedByUser && styles.verifyRowActive,
                      ]}
                      onPress={() => {
                        setMbVerifiedByUser((current) => !current);
                      }}
                    >
                      <View
                        style={[
                          styles.verifyCheckbox,
                          mbVerifiedByUser && styles.verifyCheckboxActive,
                        ]}
                      >
                        {mbVerifiedByUser ? (
                          <Ionicons
                            name="checkmark"
                            size={16}
                            color="#FFFFFF"
                          />
                        ) : null}
                      </View>
                      <View style={styles.verifyCopy}>
                        <Text style={styles.verifyTitle}>
                          I visually verified {masterLookup.mbNumber}
                        </Text>
                        <Text style={styles.verifyText}>
                          Optional confirmation against the printed daysheet. It
                          never overrides the master.
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                )}

                <Pressable
                  style={[
                    styles.primaryButton,
                    styles.uploadButton,
                    (isSubmitting || submission || !masterLookup) &&
                      styles.disabledButton,
                  ]}
                  disabled={
                    isSubmitting || Boolean(submission) || !masterLookup
                  }
                  onPress={() => {
                    void uploadOrder();
                  }}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons
                      name="cloud-upload-outline"
                      size={19}
                      color="#FFFFFF"
                    />
                  )}
                  <Text style={styles.primaryButtonText}>
                    {submission
                      ? "Uploaded"
                      : isSubmitting
                        ? "Uploading…"
                        : masterLookup
                          ? "Add Master Order to Planner"
                          : "Check Master First"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {recognizedText ? (
              <View style={styles.textCard}>
                <View style={styles.textCardHeader}>
                  <View>
                    <Text style={styles.sectionEyebrow}>
                      RAW RECOGNISED TEXT
                    </Text>
                    <Text style={styles.sectionDescription}>
                      Retained with the scanner submission for troubleshooting.
                    </Text>
                  </View>

                  <Pressable
                    style={styles.shareButton}
                    onPress={() => {
                      void shareRecognizedText();
                    }}
                  >
                    <Ionicons name="share-outline" size={17} color="#172033" />
                  </Pressable>
                </View>

                <Text selectable style={styles.recognizedText}>
                  {recognizedText}
                </Text>
              </View>
            ) : null}

            <Pressable style={styles.secondaryButton} onPress={retakePhoto}>
              <Ionicons
                name="camera-reverse-outline"
                size={18}
                color="#172033"
              />
              <Text style={styles.secondaryButtonText}>
                Scan another daysheet
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.cameraSafeArea} edges={["top"]}>
      <View style={styles.cameraHeader}>
        <View>
          <Text style={styles.cameraEyebrow}>DAYSHEET OCR SCANNER</Text>
          <Text style={styles.cameraTitle}>
            Keep the page inside the frame.
          </Text>
        </View>

        <Pressable
          style={[styles.torchButton, torchEnabled && styles.torchButtonActive]}
          onPress={() => {
            setTorchEnabled((current) => !current);
          }}
        >
          <Ionicons
            name={torchEnabled ? "flash" : "flash-outline"}
            size={21}
            color="#FFFFFF"
          />
        </Pressable>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          enableTorch={torchEnabled}
          active={isFocused}
          onCameraReady={() => {
            setIsCameraReady(true);
          }}
          onMountError={(event) => {
            setError(event.message);
          }}
        />

        <View pointerEvents="none" style={styles.cameraOverlay}>
          <View style={styles.guideFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.cameraError}>
          <Text style={styles.cameraErrorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.capturePanel}>
        <Text style={styles.captureHint}>
          Use bright, even lighting. Avoid shadows across the printed fields.
        </Text>

        <Pressable
          style={[
            styles.captureButton,
            (!isCameraReady || isRecognizing) && styles.captureButtonDisabled,
          ]}
          disabled={!isCameraReady || isRecognizing}
          onPress={() => {
            void captureAndRecognize();
          }}
        >
          <View style={styles.captureButtonInner} />
        </Pressable>

        <Text style={styles.captureStatus}>
          {isCameraReady ? "Ready to capture" : "Starting camera…"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#EEF2F6" },
  cameraSafeArea: { flex: 1, backgroundColor: "#07111E" },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 28,
  },
  stateText: { color: "#718095", fontSize: 13, fontWeight: "700" },
  permissionCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  permissionIcon: {
    width: 82,
    height: 82,
    marginBottom: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00A859",
    borderRadius: 24,
  },
  eyebrow: {
    color: "#008F4C",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  permissionTitle: {
    marginTop: 8,
    color: "#172033",
    fontSize: 25,
    fontWeight: "900",
    textAlign: "center",
  },
  permissionDescription: {
    maxWidth: 360,
    marginTop: 10,
    marginBottom: 22,
    color: "#718095",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#00A859",
    borderRadius: 11,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  disabledButton: { opacity: 0.52 },
  cameraHeader: {
    minHeight: 86,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    backgroundColor: "#07111E",
  },
  cameraEyebrow: {
    color: "#38CB83",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  cameraTitle: {
    marginTop: 5,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  torchButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.11)",
    borderRadius: 12,
  },
  torchButtonActive: { backgroundColor: "#00A859" },
  cameraContainer: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  camera: { flex: 1 },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  guideFrame: {
    width: "100%",
    maxWidth: 430,
    height: "88%",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    borderRadius: 16,
  },
  corner: {
    width: 34,
    height: 34,
    position: "absolute",
    borderColor: "#38CB83",
  },
  cornerTopLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 14,
  },
  cornerTopRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 14,
  },
  cornerBottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 14,
  },
  cornerBottomRight: {
    right: -2,
    bottom: -2,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 14,
  },
  cameraError: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: "#521621",
  },
  cameraErrorText: {
    color: "#FFDCE1",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  capturePanel: {
    paddingHorizontal: 20,
    paddingTop: 13,
    paddingBottom: 15,
    alignItems: "center",
    backgroundColor: "#07111E",
  },
  captureHint: {
    maxWidth: 410,
    color: "#AAB6C6",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
  },
  captureButton: {
    width: 72,
    height: 72,
    marginTop: 12,
    padding: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "#FFFFFF",
    borderRadius: 999,
  },
  captureButtonDisabled: { opacity: 0.4 },
  captureButtonInner: {
    width: "100%",
    height: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
  },
  captureStatus: {
    marginTop: 8,
    color: "#718095",
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  resultContent: { padding: 18, paddingBottom: 34, gap: 15 },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  resultTitle: {
    marginTop: 5,
    color: "#172033",
    fontSize: 22,
    fontWeight: "900",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE3EB",
    borderRadius: 12,
  },
  previewImage: {
    width: "100%",
    height: 220,
    backgroundColor: "#DDE3EA",
    borderRadius: 15,
  },
  processingCard: {
    padding: 24,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE3EB",
    borderRadius: 15,
  },
  processingTitle: {
    marginTop: 12,
    color: "#172033",
    fontSize: 16,
    fontWeight: "900",
  },
  processingText: {
    marginTop: 5,
    color: "#718095",
    fontSize: 11,
    textAlign: "center",
  },
  errorCard: {
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: "#FFF0F1",
    borderWidth: 1,
    borderColor: "#EFB9BF",
    borderRadius: 11,
  },
  errorText: {
    flex: 1,
    color: "#A21E2B",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 17,
  },
  successCard: {
    padding: 15,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    backgroundColor: "#E1F7EC",
    borderWidth: 1,
    borderColor: "#A9DFC3",
    borderRadius: 13,
  },
  successCopy: { flex: 1 },
  successTitle: { color: "#056D3D", fontSize: 14, fontWeight: "900" },
  successText: { marginTop: 4, color: "#176B48", fontSize: 11, lineHeight: 17 },
  successMeta: {
    marginTop: 7,
    color: "#267658",
    fontSize: 10,
    fontWeight: "800",
  },
  formCard: {
    padding: 17,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE3EB",
    borderRadius: 15,
  },
  cardHeading: {
    marginBottom: 15,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionEyebrow: {
    color: "#008F4C",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  sectionTitle: {
    marginTop: 5,
    color: "#172033",
    fontSize: 17,
    fontWeight: "900",
  },
  sectionDescription: {
    maxWidth: 280,
    marginTop: 5,
    color: "#718095",
    fontSize: 10,
    lineHeight: 15,
  },
  successBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#E1F7EC",
    borderRadius: 999,
  },
  successBadgeText: { color: "#00763F", fontSize: 9, fontWeight: "900" },
  inputLabel: {
    marginTop: 11,
    marginBottom: 6,
    color: "#45546A",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  input: {
    minHeight: 47,
    paddingHorizontal: 13,
    color: "#172033",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CFD7E1",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: "700",
  },
  warningCard: {
    marginTop: 15,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: "#FFF9E9",
    borderWidth: 1,
    borderColor: "#EFD992",
    borderRadius: 10,
  },
  warningCopy: { flex: 1, gap: 3 },
  warningText: {
    color: "#725300",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 15,
  },
  detectedCard: {
    marginTop: 15,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: "#F1FAF5",
    borderWidth: 1,
    borderColor: "#CDE8D8",
    borderRadius: 10,
  },
  detectedText: {
    flex: 1,
    color: "#176B48",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 15,
  },
  masterLookupButton: {
    minHeight: 48,
    marginTop: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EDF2F7",
    borderWidth: 1,
    borderColor: "#C9D3DF",
    borderRadius: 11,
  },
  masterLookupButtonText: {
    color: "#172033",
    fontSize: 13,
    fontWeight: "900",
  },
  masterCard: {
    marginTop: 16,
    padding: 14,
    backgroundColor: "#F4FBF7",
    borderWidth: 1,
    borderColor: "#BBDDCB",
    borderRadius: 12,
  },
  masterCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  masterIcon: {
    width: 39,
    height: 39,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00763F",
    borderRadius: 10,
  },
  masterHeaderCopy: { flex: 1 },
  masterEyebrow: {
    color: "#287153",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  masterMb: {
    marginTop: 3,
    color: "#075E37",
    fontSize: 21,
    fontWeight: "900",
  },
  masterLockedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DDF2E7",
    borderRadius: 999,
  },
  masterLockedText: {
    color: "#176B48",
    fontSize: 8,
    fontWeight: "900",
  },
  masterDetails: {
    marginTop: 12,
    paddingTop: 10,
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: "#CFE6D9",
  },
  masterDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 14,
  },
  masterDetailLabel: {
    color: "#5E7469",
    fontSize: 10,
    fontWeight: "800",
  },
  masterDetailValue: {
    flex: 1,
    color: "#183D2C",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "right",
  },
  ocrVerification: {
    marginTop: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 9,
  },
  ocrVerificationMatched: { backgroundColor: "#DFF5E9" },
  ocrVerificationUnseen: { backgroundColor: "#FFF5D9" },
  ocrVerificationText: {
    flex: 1,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 15,
  },
  ocrVerificationTextMatched: { color: "#176B48" },
  ocrVerificationTextUnseen: { color: "#725300" },
  verifyRow: {
    marginTop: 11,
    padding: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CFDAD4",
    borderRadius: 10,
  },
  verifyRowActive: {
    backgroundColor: "#E5F7ED",
    borderColor: "#8ECBAA",
  },
  verifyCheckbox: {
    width: 23,
    height: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#A7B5AE",
    borderRadius: 6,
  },
  verifyCheckboxActive: {
    backgroundColor: "#00A859",
    borderColor: "#00A859",
  },
  verifyCopy: { flex: 1 },
  verifyTitle: {
    color: "#1D4935",
    fontSize: 11,
    fontWeight: "900",
  },
  verifyText: {
    marginTop: 3,
    color: "#60766B",
    fontSize: 9,
    lineHeight: 14,
  },
  uploadButton: { marginTop: 16 },
  textCard: {
    padding: 17,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE3EB",
    borderRadius: 15,
  },
  textCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  shareButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F6F9",
    borderRadius: 10,
  },
  recognizedText: {
    marginTop: 14,
    padding: 13,
    color: "#34445B",
    backgroundColor: "#F7F9FB",
    borderRadius: 10,
    fontSize: 11,
    lineHeight: 17,
  },
  secondaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D4DCE5",
    borderRadius: 11,
  },
  secondaryButtonText: { color: "#172033", fontSize: 13, fontWeight: "900" },
});
