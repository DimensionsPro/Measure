import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Image, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';

export default function DimensionSnap({ visible, onClose, onCapture }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [camera, setCamera] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission();
    }
  }, [visible]);

  const takePicture = async () => {
    if (camera) {
      const photo = await camera.takePictureAsync({ base64: true });
      // Compress immediately for temp storage
      const manipResult = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setPreview(manipResult);
    }
  };

  const confirmCapture = () => {
    onCapture({
      uri: preview.uri,
      base64: preview.base64,
    });
    setPreview(null);
    onClose();
  };

  if (!permission?.granted) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.container}>
          <Text>We need camera permissions to use DimensionSnap</Text>
          <TouchableOpacity onPress={requestPermission} style={styles.button}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={[styles.button, { backgroundColor: '#666' }]}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="fade">
      <View style={styles.container}>
        {preview ? (
          <View style={styles.previewContainer}>
            <Image source={{ uri: preview.uri }} style={styles.camera} />
            <View style={styles.overlay}>
              <Text style={styles.hint}>Verify your photo before saving</Text>
              <View style={styles.controls}>
                <TouchableOpacity onPress={() => setPreview(null)} style={styles.captureBtn}>
                  <Text style={{ color: 'white' }}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmCapture} style={[styles.captureBtn, { backgroundColor: '#4CAF50' }]}>
                  <Text style={{ color: 'white' }}>Use Photo</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <CameraView 
            style={styles.camera} 
            ref={(ref) => setCamera(ref)}
          >
            <View style={styles.overlay}>
              <View style={styles.guideBox} />
              <Text style={styles.hint}>Align window/opening inside frame</Text>
              <View style={styles.controls}>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Text style={{ color: 'white', fontSize: 24 }}>×</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={takePicture} style={styles.captureBtn}>
                   <View style={styles.captureInner} />
                </TouchableOpacity>
              </View>
            </View>
          </CameraView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  previewContainer: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
  },
  guideBox: {
    width: '80%',
    height: '60%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 12,
    borderStyle: 'dashed',
  },
  hint: { color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' },
  captureBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 5,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
  },
  closeBtn: { padding: 20 },
  button: { padding: 15, backgroundColor: '#2196F3', borderRadius: 8, marginTop: 20 },
  buttonText: { color: 'white', fontWeight: 'bold' }
});
