/*
This is the main screen component for the Trivy's Transfer System (TTS) app.
It handles the entire file transfer flow between two users: a sender and a receiver.
The app uses QR codes and session IDs for pairing devices, and communicates with a Raspberry Pi server for file uploads and downloads.

Key features:
- Sender: selects files, enters receiver's code/QR, uploads to server
- Receiver: generates code/QR, waits for sender, accepts/rejects transfers, downloads files
- Server coordination: prepare, accept/reject, upload, list/download files

This file was built as a React Native Expo app with TypeScript.
*/

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// Type definitions for the app's data structures
// These help TypeScript understand the shape of our data and catch errors at compile time

// Represents the current screen being displayed
type Screen = 'home' | 'connect' | 'files';

// Main component for the TTS app
export default function Index() {
  const initialServerAddress = 'http://192.168.157.238:3000'
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [files, setFiles] = useState<any[]>([])
  const [receivedFiles, setReceivedFiles] = useState<any[]>([])
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)//this is the state of the scanning
  const [transferStatus, setTransferStatus] = useState('')//this is for the mock file transfer,to see how it will work
  const [permission, requestPermission] = useCameraPermissions()
  const [serverAddress, setServerAddress] = useState(initialServerAddress); 
  const [role, setRole] = useState<'send' | 'receive' | null>(null)
  const [hasReceivedTransfer, setHasReceivedTransfer] = useState(false)
  const activeSessionRef = React.useRef<string | null>(null)

  //this is a simple encryption because this is a prototype so it isnt
  //a huge encryption security wise but it works, hopefully
  const encrypt = (text: string) => text
  const decrypt = (text: string) => text

  // Helper function to format file sizes in human-readable format
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileName = (file: any, index: number): string => {
    if (file?.name) return file.name;
    if (file?.originalName) return file.originalName;
    if (typeof file?.uri === 'string') {
      const parts = file.uri.split('/');
      return parts[parts.length - 1] || `file-${index}`;
    }
    return `file-${index}`;
  };

  const resetToHome = React.useCallback(() => {
    activeSessionRef.current = null
    setSessionId(null)
    setScreen('home')
    setFiles([])
    setReceivedFiles([])
    setCode('')
    setScanning(false)
    setTransferStatus('')
    setRole(null)
    setHasReceivedTransfer(false)
  }, [])

  const beginSession = React.useCallback((nextRole: 'send' | 'receive', nextSessionId: string | null = null) => {
    activeSessionRef.current = nextSessionId
    setRole(nextRole)
    setSessionId(nextSessionId)
    setScreen('connect')
    setFiles([])
    setReceivedFiles([])
    setCode('')
    setScanning(false)
    setTransferStatus('')
    setHasReceivedTransfer(false)
  }, [])

  const isSessionStillActive = React.useCallback((candidateSessionId: string | null) => {
    return activeSessionRef.current != null && activeSessionRef.current === candidateSessionId
  }, [])

  React.useEffect(() => {
    activeSessionRef.current = sessionId
  }, [sessionId])

  // Receiver: poll for received files when on files screen
  // This effect runs every 2 seconds to check for new uploaded files
  React.useEffect(() => {
    if (screen === 'files' && role === 'receive' && sessionId) {
      let mounted = true;
      const pollFiles = async () => {
        while (mounted && screen === 'files' && role === 'receive') {
          try {
            const r = await fetch(`${serverAddress}/session/${encodeURIComponent(sessionId)}/files`);
            if (r.ok) {
              const j = await r.json();
              const nextFiles = j.files || [];
              if (!mounted || !isSessionStillActive(sessionId)) {
                return;
              }

              setReceivedFiles(nextFiles);
              if (nextFiles.length > 0) {
                setHasReceivedTransfer(true)
                setTransferStatus('Files ready to download');
              } else if (hasReceivedTransfer) {
                resetToHome()
                return;
              }
            }
          } catch (e) {
            // ignore network errors
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      };
      pollFiles();
      return () => { mounted = false };
    }
  }, [screen, role, sessionId, serverAddress, hasReceivedTransfer, isSessionStillActive, resetToHome]);

  React.useEffect(() => {
    if (screen === 'files' && role === 'send' && sessionId) {
      let mounted = true;
      const pollCompletion = async () => {
        while (mounted && screen === 'files' && role === 'send') {
          try {
            const response = await fetch(`${serverAddress}/session/${encodeURIComponent(sessionId)}`);
            if (response.ok) {
              const json = await response.json();
              const status = json.session?.status;

              if (!mounted || !isSessionStillActive(sessionId)) {
                return;
              }

              if (status === 'completed') {
                resetToHome()
                return;
              }
            }
          } catch (e) {
            // ignore network errors while polling
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      };
      pollCompletion();
      return () => { mounted = false };
    }
  }, [screen, role, sessionId, serverAddress, isSessionStillActive, resetToHome]);

  // Function to pick files from the device using Expo's DocumentPicker
  // Allows users to select any type of file from their device storage
  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true
    })
  
    // handle different expo versions return shapes
    if ((result as any).canceled === false && Array.isArray((result as any).assets) && (result as any).assets.length > 0) {
      setFiles(prev => [...prev, (result as any).assets[0]])
      return
    }
    if ((result as any).type === 'success') {
      setFiles(prev => [...prev, result])
      return
    }
    if ((result as any).name || (result as any).uri) {
      setFiles(prev => [...prev, result])
    }
  }

  const pickPhoto = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permissionResult.granted) {
      Alert.alert('Permission needed', 'Photo library access is needed to choose photos.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1
    })

    if (!result.canceled && Array.isArray(result.assets) && result.assets.length > 0) {
      setFiles(prev => [
        ...prev,
        ...result.assets.map((asset, index) => ({
          ...asset,
          name: asset.fileName || asset.assetId || `photo-${Date.now()}-${index}.jpg`,
          size: asset.fileSize || 0,
          mimeType: asset.mimeType || 'image/jpeg'
        }))
      ])
    }
  }

  const pickFile = async () => {
    if (Platform.OS === 'web') {
      await pickDocument()
      return
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Files', 'Photos'],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await pickDocument()
          }
          if (buttonIndex === 2) {
            await pickPhoto()
          }
        }
      )
      return
    }

    Alert.alert('Choose Source', 'Where would you like to add from?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Files', onPress: () => { void pickDocument() } },
      { text: 'Photos', onPress: () => { void pickPhoto() } },
    ])
  }

  // Function to remove a file from the selected files list by index
  const removeFile = (index: number) => {
    const updated = [...files];  // Create a copy of the files array
    updated.splice(index, 1);    // Remove the file at the specified index
    setFiles(updated);           // Update the state with the new array
  };

  // Function to start QR code scanning using the camera
  // Requests camera permission if not already granted
  const startScanning = async () => {
    if (!permission?.granted) {
      await requestPermission()
    }
    setTransferStatus('')
    setScanning(true)
  }

  // Main function to upload files to the Raspberry Pi server
  // This handles the complete transfer flow: prepare -> wait for acceptance -> upload
  async function uploadFilesToPi(sessionId: string | null) {
    const currentSessionId = sessionId
    if (!sessionId) {
      setTransferStatus('No session id');
      return;
    }
    if (files.length === 0) {
      setTransferStatus('No files selected');
      return;
    }
    try {
      // Step 1: Prepare the transfer by sending file metadata to the server
      // This tells the receiver what files are coming without uploading yet
      const metadata = files.map((f: any, i: number) => ({ name: f.name || `file-${i}`, size: f.size || 0, type: f.mimeType || 'application/octet-stream' }));
      setTransferStatus('Preparing transfer...');
      const prep = await fetch(`${serverAddress}/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files: metadata })
      });
      if (!isSessionStillActive(currentSessionId)) {
        return;
      }
      if (!prep.ok) {
        const t = await prep.text();
        setTransferStatus(`Prepare failed: ${prep.status} ${t}`);
        return;
      }

      // Step 2: Wait for the receiver to accept or reject the transfer
      // Poll the session status every 2 seconds for up to 60 seconds
      setTransferStatus('Waiting for receiver to accept...');
      const start = Date.now();
      const timeoutMs = 60_000; // 60 seconds timeout
      let accepted = false;
      while (Date.now() - start < timeoutMs) {
        const sres = await fetch(`${serverAddress}/session/${encodeURIComponent(sessionId)}`);
        if (sres.ok) {
          const json = await sres.json();
          if (!isSessionStillActive(currentSessionId)) {
            return;
          }
          const pending = json.session?.pending;
          if (pending?.status === 'accepted') {
            accepted = true;
            break;  // Receiver accepted, proceed to upload
          }
          // If pending is null, treat as rejection (receiver rejected or session cleared)
          if (!pending || pending?.status === 'rejected') {
            setTransferStatus('❌ Transfer rejected by receiver. Please select new files to try again.');
            setFiles([]);  // Clear files so sender can pick new ones
            return;  // Receiver rejected, stop here
          }
        }
        // Wait 2 seconds before checking again
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!accepted) {
        setTransferStatus('Timeout waiting for receiver to accept');
        return;  // Timeout, transfer cancelled
      }

      // Step 3: Upload the actual files now that transfer is accepted
      setTransferStatus('Receiver accepted — uploading...');
      const form = new FormData();
      files.forEach((f: any, i: number) => {
        const uri = f.uri || f.fileUri || f.uri;
        const name = f.name || `file-${i}`;
        const type = f.mimeType || 'application/octet-stream';
        // Handle different platforms: web vs native file handling
        if (Platform.OS === 'web' && typeof (f as any).file === 'object') {
          form.append('files', (f as any).file, name);
        } else {
          form.append('files', { uri, name, type } as any);
        }
      });

      // Send the files to the server
      const res = await fetch(`${serverAddress}/upload?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        body: form,
        headers: { 'Accept': 'application/json' }
      });
      if (!isSessionStillActive(currentSessionId)) {
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        setTransferStatus(`Upload failed: ${res.status} ${text}`);
        return;
      }
      const rjson = await res.json();
      setTransferStatus(`${rjson.message || 'Upload complete'}. Waiting for downloads to finish...`);
    } catch (err: any) {
      if (isSessionStillActive(currentSessionId)) {
        setTransferStatus(`Upload error: ${err.message || err}`);
      }
    }
  }

  // Header component that appears on connect and files screens
  // Shows the TTS logo and a close button to return to home
  function Header() {
    return (
      <View style={styles.header}>
        <Text style={styles.logo}>TTS</Text>

        <TouchableOpacity onPress={resetToHome} style={styles.closeButton}>
          <Text style={styles.closeText}>X</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Home screen: Initial screen where user chooses to send or receive files
  if (screen === 'home') {
    return (
      <View style={styles.container}>
        <Text style={styles.logoLarge}>TTS</Text>

        <Text style={styles.title}>Trivy&apos;s Transfer System</Text>

        {/* Send File button - navigate directly to connect screen */}
        <TouchableOpacity
          style={styles.mainButton}
          onPress={() => {
            beginSession('send')
          }}
        >
          <Text style={styles.buttonText}>Send File</Text>
        </TouchableOpacity>

        {/* Receive File button - navigate directly to connect screen and generate session ID */}
        <TouchableOpacity
          style={styles.mainButton}
          onPress={() => {
            const id = Math.random().toString(36).substring(2, 8)
            beginSession('receive', id)
          }}
        >
          <Text style={styles.buttonText}>Receive File</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>No sign up required!</Text>
      </View>
    )
  }

  // Connect screen: Where pairing happens
  // Receivers see their code/QR to share, senders enter code or scan QR
  if (screen === 'connect') {
    return (
      <ScrollView
        style={styles.connectScroll}
        contentContainerStyle={styles.connectContent}
        showsVerticalScrollIndicator={true}
      >
        <Header />

        <Text style={styles.title}>{role === 'receive' ? 'Receive File: Share Code' : 'Send File: Connect Device'}</Text>

        {role === 'send' ? (
          <TouchableOpacity
            style={styles.mainButton}
          onPress={startScanning}
          >
            <Text style={styles.buttonText}>Scan QR</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ marginVertical: 10 }}>Share this code with the sender to receive files</Text>
        )}

      {scanning && (//this is adding in the scanner view to connect device and files
      //along with device, hence session ID
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }} 
          onBarcodeScanned={({ data }: { data: string }) => {
            setSessionId(data)
            setTransferStatus('')
            setScanning(false)
            setScreen('files')
          }}
          style={{ width: 250, height: 250, marginTop: 20 }}/>
        )}
      {sessionId && role === 'receive' && (
        <>
        <Text>Session Code: {sessionId}</Text>
        <QRCode value={sessionId} size={180} />
        </>
      )}

        {role === 'send' && (
          <>
            <Text style={styles.orText}>OR</Text>

            <TextInput placeholder="Input Code" value={code} onChangeText={setCode} style={styles.input} />

            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => {
                if (code.trim()){
                  const trimmed = code.trim()
                  setSessionId(trimmed)
                  setTransferStatus('')
                  setScreen('files')
                }
              }}
            >
              <Text style={styles.buttonText}>Find Device</Text>
            </TouchableOpacity>
          </>
        )}

        {/* If receiver sees a pending transfer, show details + accept/reject */}
        {role === 'receive' && sessionId && (
          <ReceiverPending sessionId={sessionId} serverAddress={serverAddress} setTransferStatus={setTransferStatus} setScreen={setScreen} formatFileSize={formatFileSize} />
        )}
      </ScrollView>
    )
  }

  // Files screen: Main file management interface
  // Different UI for senders (add/upload files) vs receivers (view/download files)
  if (screen === 'files') {
    return (
      <View style={styles.container}>
        <Header />

        {role === 'send' ? (
          // Sender view: add and send files
          <>
            <Text style={styles.title}>Send File: Add Files</Text>

            {role !== 'send' && (
              <TextInput
                placeholder="Pi server (http://192.168.157.238:3000)"
                value={serverAddress}
                onChangeText={setServerAddress}
                style={[styles.input, { marginTop: 6 }]}
              />
            )}

            <FlatList
                data={files}
                key={files.length === 0 ? Math.random().toString(36) : files.map(f => f.name || f.uri).join(',')}
                keyExtractor={(item, index) => index.toString()}
                style={styles.fileList}
                contentContainerStyle={styles.fileListContent}
                renderItem={({ item, index }) => (
                  <View style={styles.fileRow}>
                    <View style={styles.fileMeta}>
                      <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="tail">
                        {getFileName(item, index)}
                      </Text>
                      <Text style={styles.fileSize}>
                        {formatFileSize(item.size || 0)}
                      </Text>
                    </View>

                    <TouchableOpacity onPress={() => removeFile(index)}>
                      <Text style={styles.removeButton}>X</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={<Text style={styles.emptyText}>No files added yet</Text>}
              />

            <TouchableOpacity style={styles.smallButton} onPress={pickFile}>
              <Text style={styles.buttonText}>Add File</Text>
            </TouchableOpacity>
              
            <TouchableOpacity style={styles.mainButton} onPress={() => uploadFilesToPi(sessionId)}>
              <Text style={styles.buttonText}>Transfer Files</Text>
            </TouchableOpacity>

            {transferStatus !== '' && (
              <Text style={{marginTop: 10 }}>{transferStatus}</Text>
            )}
          </>
        ) : (
          // Receiver view: download files
          <>
            <Text style={styles.title}>Receive File: Downloaded Files</Text>

            <FlatList
              data={receivedFiles}
              keyExtractor={(item, index) => index.toString()}
              style={styles.fileList}
              contentContainerStyle={styles.fileListContent}
                renderItem={({ item, index }) => (
                  <View style={styles.fileRow}>
                  <View style={styles.fileMeta}>
                    <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="tail">
                      {getFileName(item, index)}
                    </Text>
                    <Text style={styles.fileSize}>
                      {formatFileSize(item.size || 0)}
                    </Text>
                  </View>

                  <TouchableOpacity onPress={() => {
                    const downloadUrl = `${serverAddress}/session/${encodeURIComponent(sessionId!)}/download/${encodeURIComponent(item.originalName)}`;
                    // For web, trigger download via anchor; for native, open URL in browser
                    if (Platform.OS === 'web') {
                      const a = document.createElement('a');
                      a.href = downloadUrl;
                      a.download = item.originalName;
                      a.click();
                    } else {
                      // iOS/Android: open URL with Linking
                      Linking.openURL(downloadUrl);
                    }
                  }}>
                    <Text style={{ color: '#3b6aa0', fontWeight: '600' }}>Download</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>Waiting for files...</Text>}
            />

            {transferStatus !== '' && (
              <Text style={{marginTop: 10 }}>{transferStatus}</Text>
            )}
          </>
        )}
      </View>
    )
  }

  return null
}

// ReceiverPending component: Handles the accept/reject flow for receivers
// Polls the server for pending transfers and shows buttons to accept or reject
function ReceiverPending({ sessionId, serverAddress, setTransferStatus, setScreen, formatFileSize }: any) {
  const [pending, setPending] = useState<any | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const poll = async () => {
      while (mounted) {
        try {
          const r = await fetch(`${serverAddress}/session/${encodeURIComponent(sessionId)}`);
          if (r.ok) {
            const j = await r.json();
            const p = j.session?.pending || null;
            if (mounted) setPending(p);
          }
        } catch (e) {
          // ignore network errors while polling
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { mounted = false };
  }, [sessionId, serverAddress]);

  // Show "Waiting for sender..." message when there's no pending transfer yet
  if (!pending) {
    return (
      <View style={{ marginTop: 14, alignItems: 'center' }}>
        <Text style={{ fontWeight: '600', marginBottom: 8 }}>Waiting for sender...</Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 14, alignItems: 'center' }}>
      <Text style={{ fontWeight: '700', marginBottom: 8 }}>Incoming files</Text>
      <ScrollView
        style={styles.pendingFilesList}
        contentContainerStyle={styles.pendingFilesContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
      >
        {pending.files.map((f: any, i: number) => (
          <View key={i} style={styles.pendingFileRow}>
            <Text style={styles.pendingFileName} numberOfLines={1} ellipsizeMode="tail">{f.name}</Text>
            <Text style={styles.pendingFileSize}>{formatFileSize(f.size)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', marginTop: 12 }}>
        <TouchableOpacity style={[styles.smallButton, { marginRight: 8 }]} onPress={async () => {
          try {
            const r = await fetch(`${serverAddress}/session/${encodeURIComponent(sessionId)}/accept`, { method: 'POST' });
            if (r.ok) {
              setTransferStatus('Accepted transfer — waiting for upload');
              // move to files screen to show incoming progress
              setScreen('files');
            } else {
              setTransferStatus('Failed to accept');
            }
          } catch (e: any) {
            setTransferStatus(`Accept error: ${e.message || e}`);
          }
        }}>
          <Text style={styles.buttonText}>Accept</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.smallButton} onPress={async () => {
          try {
            const r = await fetch(`${serverAddress}/session/${encodeURIComponent(sessionId)}/reject`, { method: 'POST' });
            if (r.ok) {
              setTransferStatus('Rejected transfer');
              setPending(null);
            } else {
              setTransferStatus('Failed to reject');
            }
          } catch (e: any) {
            setTransferStatus(`Reject error: ${e.message || e}`);
          }
        }}>
          <Text style={styles.buttonText}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Styles for the app components
// Uses React Native's StyleSheet for optimized styling and consistent theming
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#8fa3c6',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 20,
    paddingTop: 180
  },

  connectScroll: {
    flex: 1,
    backgroundColor: '#8fa3c6'
  },

  connectContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 180,
    paddingBottom: 40
  },

  header: {
    position: 'absolute',
    top: 18,
    left: 0,
    right: 0,
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    elevation: 50,
    backgroundColor: 'transparent'
  },

  logo: {
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: -6
  },

  logoLarge: {
    fontSize: 42,
    fontWeight: 'bold',
    marginBottom: 10
  },

  closeButton: {
    position: 'absolute',
    right: 30
  },

  closeText: {
    fontSize: 22,
    fontWeight: 'bold'
  },

  title: {
    fontSize: 22,
    marginBottom: 12,
    textAlign: 'center'
  },

  mainButton: {
    backgroundColor: '#e9e1d6',
    padding: 16,
    borderRadius: 30,
    width: 220,
    alignItems: 'center',
    marginVertical: 10
  },

  smallButton: {
    backgroundColor: '#e9e1d6',
    padding: 12,
    borderRadius: 20,
    marginTop: 15,
    width: 220,
    alignItems: 'center'
  },

  smallButtonDisabled: {
    backgroundColor: '#cfc7b9'
  },

  buttonText: {
    fontSize: 16,
    fontWeight: '600'
  },

  input: {
    backgroundColor: 'white',
    width: 220,
    padding: 10,
    borderRadius: 5,
    marginTop: 10
  },

  orText: {
    marginVertical: 10
  },

  footerText: {
    marginTop: 40,
    fontSize: 12
  },

  // FlatList styling
  fileList: {
    width: 320,
    maxHeight: 320,
    marginBottom: 10
  },

  fileListContent: {
    paddingBottom: 10
  },

  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#dfe6f2',
    width: '100%',
    padding: 10,
    marginBottom: 10,
    borderRadius: 8
  },

  fileMeta: {
    flex: 1,
    marginRight: 8
  },

  fileName: {
    fontSize: 16,
    flexShrink: 1
  },

  fileSize: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
    color: '#334a6d'
  },

  removeButton: {
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8
  },

  pendingFileRow: {
    width: 280,
    backgroundColor: '#dfe6f2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8
  },

  pendingFilesList: {
    width: 300,
    maxHeight: 220
  },

  pendingFilesContent: {
    paddingBottom: 4
  },

  pendingFileName: {
    fontSize: 15
  },

  pendingFileSize: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334a6d',
    marginTop: 2
  },

  deviceLabel: {
    marginTop: 15,
    fontSize: 14
  },

  emptyText: {
    textAlign: 'center',
    color: '#2b2b2b',
    paddingVertical: 12
  }
})
/*Testing Mode
Device Tab (Eri) shows the session QR
Device Ipad (Eri) scans the qr code
both need expo go, so download expo go on apple
and scan tablet QR code given when sending file
*/
