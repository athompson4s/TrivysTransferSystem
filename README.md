#Trivy's Transfer System (TTS)

##This README file is made on 4/30/2026, made for Senior Capstone Project. It is required to have 2 or more devices, one Android and one iOS.

##TTS is a session-based file transfer application the enables users to send and receive files using QR codes and/or session IDs.
The system is currently using a Raspberry Pi as a server to coordinate and store files during transfer. Future work is to aim for supporting a direct peer-to-peer transder and end-to-end encryption, along with HTTPS(SSL/TLS) for the website.

##Features:
-QR code device pairing
-Cross Platform (iOS, Android, Windows 10/11)
-Receiving files using QR code or session ID
-File transfer using Raspberry Pi server
-Temporary file storage
-Approval system (User control to accept/reject) before upload
-Automatic cleanup after session ends
-Real-time polling for transfer status updates 

##Materials and SetUp Overview
The application was made on VS code, and the bascked used Raspberry Pi as server. The server runs using command prompt/terminal.

###Hardware Requirements 
-Raspberry Pi (3 Model B)
    -Amazon Basic microSDXC memory card (for this project, the storage used is 128GB, did not needed a large storage, however it was more than enough)
    -Micro-USB (for Pi 3 and earlier (Used for power/connection from Pi to PC, works on cmd))

###Raspberry Pi Setup
1.System Updates
-sudo apt upgrade
2.Instal Node.js
-Node.js
    -sudo apt install nodejs npm -y
    -sudo apt install -y nodejs
    (refer to Node.js website for recent version)
3.Install Express Backend Dependencies
-Express.js
    -npm init -y
    -npm install express cors multer
Inside server folder:
-cd server
-npm install
Dependencies used:
-express
-cors
-multer = npm install express cors multer

4.Enable SSH (used for server sessions)
    -sudo raspi-config

5.Run Server
    -node server.js

####Network Reuquirements
In order for Raspberry Pi and mobile devices are working and enable to transfer, they are to be on the same Wi-Fi network. Use the Pi's local IP address.
For this project, the majority of the Wi-Fi used was based on a developers (unlimited data plan) hotspot. The PC, server, tablets, and phones MUST BE on the SAME NETWORK IN ORDER TO WORK. 

1.Running Expo (Expo Go on mobile)
-Requirements
    -node.js installed (terminal or download for Node.js website)
    -After installation, verify
        node -v
        npm -v
    -Download Expo Go from Apple/Play Store

2.Expo install dependencies (Terminal VScode)
(For application to work, don't forget to ignore "-")
-npx expo install expo-camera
    -import { CameraView, useCameraPermissions } from 'expo-camera';
-npx expo install expo-document-picker 
    -import * as DocumentPicker from 'expo-document-picker';
-npx expo install expo-image-picker
    -import * as ImagePicker from 'expo-image-picker';
-npm install react-native-qrcode-svg
    -import QRCode from 'react-native-qrcode-svg';
    if don't work, use
    -npm install react-native-svg

Running Application
1.Set up Raspberry Pi
Run:
node server.js
2.Start Expo project (VScode terminal)
-npx create-expo-app my-app
OR
-cd your-project-folder
(can make project manually by going into a folder user made)

-npx install

-npx expo start --tunnel

####Using --tunnel for the same network. The project used --tunnel because the public university WiFi blocked connection between devices. If error, clean cache on terminal
npx expo start --tunnel -c

####If user don't need --tunnel
use:
npx expo start
####This starts the Metro bundler
####Show QR code for devices to scan to open the application on their Expo Go app
####Open Expo Dev Tools in browser (opens local host website)


3.Project Start Order
    1.Set Up Pi server
    2.Start backend (node server.js)
    3.Start Expo in VScode (npx expo start --tunnel)
    4.Open Expo Go on mobile devices
    5.Connect via QR code or session ID

How TTS works
Sender:
1.Select "Send File"
2.Connect using QR code or session ID
3.Choose "Add Files" (Documents/photos)
4.Select "Transfer Files", transfer request to server
5.Wait for reciever approval
6.Upload begins after acceptance

Receiver:
1.Select "Receive File"
2.Share generated QR/session ID
3.View incoming file list
4.Accept/Reject file transfer
5.Download files when ready



Limitations:
Centralized server required (not peer-to-peer)
No end-to-end encryption implemented
Requires same network or tunnel connection
File persistence depends on server cleanup logic

Future Work:
Peer-to-peer transfer using WebRTC
End-to-end encryption for file security
Real-time updates using WebSockets
Automatic file cleanup after download
Improved error handling and transfer progress UI



#Server server.js Documentation--------------------------
The backend server for TTS is built using Node.js and Express.js

###This part of the README is focused based on the server.js whereas before it focus on index.tsx and the installation to get the project ready

This js handles session-based file transfer between devices:
-Session creation and tracking
-File upload handling
-Accept/reject transfer control
-File storage and download
-Automatic cleanup after download
-Real-time polling support

The server stores session data in memory using a Map, meaning all sessions are temporary and reset when the server restarts.

Key Technologies Used
-Express.js = API routing and server logic
-Multer = File upload handling
-CORS = Cross-device communication
-Node.js fs/path = File system management
-In-memory Map = Session storage
-Custom logging system = Debugging and tracking transfer flow

Session-Based Lifecycle
Each transfer uses a unique sessionID for each lifecycle
1.Prepare transfer (sends file metadata) (status: Waiting)
2.Receiver accepts or rejects
3.Upload files (files uploaded using Multer, stored on Pi file system)
4.Receiver downloads files
5.Session completes and cleans up (automatically)

API Endpoints (Backend)
#POST /prepare → Initialize transfer session
EX:
{
  "sessionId": "abc123",
  "files": [
    { "name": "file1.jpg", "size": 12345 }
  ]
}
#POST /upload = Upload files to server
#GET /session/:id = Get session status
#GET /session/:id/files = List files
#POST /session/:id/accept = Accept transfer
#POST /session/:id/reject = Reject transfer
#GET /session/:id/download/:file = Download file

File Storage System
/uploads = files are stored in
After downloads:
-files are deleted from disk
-session is updated
-no files remain = session completed (marked)

####The session are stored in memory but are not persistently there after every cycle. Restarting the server clears all active sessions and it requires to be on the same network or tunnel access

Run on server:
node server.js

transferStats.js Documentation----------------------------
The transferStat tracks analytics for all file transfer sessions in the system

Usefuleness:
-Knows how often it works
-fast it works
-where it fails
-debugging and troubleshooting
-tracks speedness of transfer and completion time

The Analytics are:
-Number of transfers
-File counts and sizes
-Acceptance/rejection rates
-Transfer duration
-Upload/download activity
-Performance peaks (largest transfer, fastest transfer, etc)

/server/data/transfer-stats.json = data statistics stored in

server.js uses these modules to mark tracked events
#/prepare	    markPrepared()
#/accept	    markAccepted()
#/reject	    markRejected()
#/upload	    markUploadCompleted()
#/download	    markDownloaded()

This .js calculates:
#Acceptance rate 
#Completion rate
#Download success rate (%)
#Average files per transfer
#Average transfer size (MB)
#Average completion time
#Best transfer throughput (MB/s)

However it does reset:
reset() function which clears
-All statistics
-Active sessions
-stored JSON file
