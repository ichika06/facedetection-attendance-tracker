import React, { useRef, useEffect, useState, useCallback } from "react";
import * as faceapi from 'face-api.js';
import supabase from "@/lib/supabase";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, FileDown, CalendarCheck, Trash2, Plus } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const FaceDetection = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamCanvasRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [labeledDescriptors, setLabeledDescriptors] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isAutoDetectionOn, setIsAutoDetectionOn] = useState(true);
  const [detectedFaces, setDetectedFaces] = useState({});
  const [progress, setProgress] = useState(13);
  const [showAddRecordDialog, setShowAddRecordDialog] = useState(false);

  const [startOnTimeHour, setStartOnTimeHour] = useState(8);
  const [startOnTimeMinute, setStartOnTimeMinute] = useState(0);
  const [startOnTimeAmPm, setStartOnTimeAmPm] = useState("AM");
  const [endOnTimeHour, setEndOnTimeHour] = useState(9);
  const [endOnTimeMinute, setEndOnTimeMinute] = useState(0);
  const [endOnTimeAmPm, setEndOnTimeAmPm] = useState("AM");
  const [showSettings, setShowSettings] = useState(false);
  const [useCurrentDate, setUseCurrentDate] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const get24HourTime = (hour, amPm) => {
    if (amPm === "AM") {
      return hour === 12 ? 0 : hour;
    } else {
      return hour === 12 ? 12 : hour + 12;
    }
  };

  const loadModels = useCallback(async () => {
    try {
      const MODEL_URL = "/models";
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      setIsModelLoaded(true);
      // console.log("Models loaded successfully");
    } catch (err) {
      console.error("Error loading models:", err);
      setError("Failed to load face detection models.");
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const fetchLabeledImages = useCallback(async () => {
    if (!isModelLoaded) return;

    try {
      const timestamp = new Date().getTime();
      const response = await fetch(`/api/faces?t=${timestamp}`);
      const data = await response.json();
      // console.log("Fetched faces:", data.faces);

      if (data.error) throw new Error(data.error);

      const labeledDescriptors = await Promise.all(
        data.faces.map(async (imgUrl) => {
          const cacheBustUrl = `${imgUrl}?t=${timestamp}`;
          const img = await faceapi.fetchImage(cacheBustUrl);
          const detection = await faceapi.detectSingleFace(img)
            .withFaceLandmarks()
            .withFaceDescriptor();
          if (!detection) throw new Error(`No faces detected for ${imgUrl}`);

          const label = imgUrl.split("/").pop().split(".")[0];
          return new faceapi.LabeledFaceDescriptors(label, [detection.descriptor]);
        })
      );

      setLabeledDescriptors(labeledDescriptors);
      // console.log("Face descriptors updated");
      setDetectedFaces({});

      const timer = setTimeout(() => setProgress(100), 500);
      return () => clearTimeout(timer);

    } catch (err) {
      console.error("Error loading labeled images:", err);
      setError("Failed to load face images.");
    }
  }, [isModelLoaded]);

  useEffect(() => {
    const setupESP32VideoStream = async () => {
      if (!videoRef.current || !streamCanvasRef.current) return;

      const video = videoRef.current;
      const streamCanvas = streamCanvasRef.current;
      const ctx = streamCanvas.getContext('2d');

      streamCanvas.width = 640;
      streamCanvas.height = 480;

      const stream = streamCanvas.captureStream(24); // 24 fps
      video.srcObject = stream;

      try {
        const response = await fetch('/api/proxy');

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const reader = response.body.getReader();
        const img = new Image();
        let buffer = new Uint8Array(0);

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;
          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;

          let startIdx = -1;
          let endIdx = -1;

          for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
              startIdx = i;
            }
            if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9 && startIdx !== -1) {
              endIdx = i + 2;
              break;
            }
          }

          if (startIdx !== -1 && endIdx !== -1) {
            const jpegData = buffer.slice(startIdx, endIdx);

            const blob = new Blob([jpegData], { type: 'image/jpeg' });
            const imageUrl = URL.createObjectURL(blob);
            img.onload = () => {
              ctx.drawImage(img, 0, 0, streamCanvas.width, streamCanvas.height);
              URL.revokeObjectURL(imageUrl);

              if (!isStreamReady) {
                setIsStreamReady(true);
              }
            };

            img.src = imageUrl;
            buffer = buffer.slice(endIdx);
          }
        }
      } catch (error) {
        console.error('Error fetching MJPEG stream:', error);
        setError("Failed to connect to camera stream.");

        setTimeout(setupESP32VideoStream, 5000);
      }
    };

    const currentVideo = videoRef.current;
    setupESP32VideoStream();

    return () => {
      if (currentVideo && currentVideo.srcObject) {
        const tracks = currentVideo.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [isStreamReady]);

  useEffect(() => {
    if (isModelLoaded) {
      fetchLabeledImages();
    }
  }, [isModelLoaded, refreshTrigger, fetchLabeledImages]);

  const getAttendanceStatus = (checkTime = null) => {
    const now = checkTime ? new Date(checkTime) : new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    const startHour24 = get24HourTime(startOnTimeHour, startOnTimeAmPm);
    const endHour24 = get24HourTime(endOnTimeHour, endOnTimeAmPm);

    const startOnTimeInMinutes = startHour24 * 60 + startOnTimeMinute;
    const endOnTimeInMinutes = endHour24 * 60 + endOnTimeMinute;

    return timeInMinutes >= startOnTimeInMinutes && timeInMinutes <= endOnTimeInMinutes
      ? "On Time"
      : "Late";
  };

  const toggleAmPm = (setter, current) => {
    setter(current === "AM" ? "PM" : "AM");
  };

  const getCurrentDate = () => {
    return useCurrentDate ? new Date().toLocaleDateString() : new Date(selectedDate).toLocaleDateString();
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  

  const detectFaces = useCallback(async () => {
    if (isModelLoaded && videoRef.current && isStreamReady && labeledDescriptors && labeledDescriptors.length > 0) {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      const displaySize = {
        width: streamCanvasRef.current.width,
        height: streamCanvasRef.current.height
      };
      canvas.width = displaySize.width;
      canvas.height = displaySize.height;

      faceapi.matchDimensions(canvas, displaySize);

      try {
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        faceapi.draw.drawDetections(canvas, resizedDetections);
        faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);

        const currentTime = Date.now();
        const timestamp = new Date().toLocaleTimeString();
        const currentDate = getCurrentDate();
        const status = getAttendanceStatus();

        if (resizedDetections.length > 0) {
          const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

          results.forEach((result, i) => {
            const { label, distance } = result;
            const confidencePercent = Math.round((1 - distance) * 100);
            const text = `${label} (${confidencePercent}%)`;
            const box = resizedDetections[i].detection.box;
            const drawBox = new faceapi.draw.DrawBox(box, { label: text });
            drawBox.draw(canvas);

            if (label !== "unknown" && confidencePercent > 50) {
              const personKey = `${label}_${currentDate}`;

              if (!detectedFaces[personKey]) {
                // console.log(`New face detected: ${label} with confidence ${confidencePercent}%`);

                setAttendance(prev => [...prev, {
                  name: label,
                  time: timestamp,
                  confidence: confidencePercent,
                  status: status,
                  date: currentDate
                }]);
                setDetectedFaces(prev => ({
                  ...prev,
                  [personKey]: { time: currentTime, confidence: confidencePercent }
                }));

                // console.log(`Attendance automatically recorded for ${label} at ${timestamp} - Status: ${status}`);
              }
            }
          });
        }
      } catch (err) {
        console.error("Error during face detection:", err);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelLoaded, isStreamReady, labeledDescriptors, detectedFaces, startOnTimeHour, startOnTimeMinute, endOnTimeHour, endOnTimeMinute, useCurrentDate, selectedDate, getCurrentDate, getAttendanceStatus]);

  useEffect(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }

    if (
      isAutoDetectionOn &&
      isModelLoaded &&
      isStreamReady &&
      labeledDescriptors &&
      labeledDescriptors.length > 0
    ) {
      // console.log("Starting automatic face detection");

      detectionIntervalRef.current = setInterval(() => {
        detectFaces();
      }, 1000);
    }

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, [
    isAutoDetectionOn,
    isModelLoaded,
    isStreamReady,
    labeledDescriptors,
    detectFaces
  ]);

  const captureAndUpload = async () => {
    const name = prompt("Enter your name before uploading:");
    if (!name) {
      alert("Upload canceled. Name is required.");
      return;
    }

    if (videoRef.current && isStreamReady) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = streamCanvasRef.current.width;
      canvas.height = streamCanvasRef.current.height;
      context.drawImage(streamCanvasRef.current, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        const fileName = `faces/${name}.png`;
        const { data, error } = await supabase.storage.from("Attendancetracking").upload(fileName, blob, {
          contentType: "image/png",
          upsert: true
        });

        if (error) {
          console.error("Upload error:", error);
          setError("Failed to upload image.");
        } else {
          // console.log("Uploaded image:", data);
          alert(`Image uploaded successfully for ${name}`);

          const status = getAttendanceStatus();
          const currentDate = getCurrentDate();

          const timestamp = new Date().toLocaleTimeString();
          setAttendance(prev => [...prev, {
            name: name,
            time: timestamp,
            confidence: "-",
            status: status,
            date: currentDate
          }]);

          setRefreshTrigger(prev => prev + 1);
        }
      }, "image/png");

    } else {
      setError("Video stream not ready. Please wait.");
    }
  };

  const toggleAutoDetection = () => {
    setIsAutoDetectionOn(!isAutoDetectionOn);
  };

  const clearAttendance = () => {
    setAttendance([]);
    setDetectedFaces({});
  };

  const deleteAttendanceRecord = (index) => {
    const updatedAttendance = [...attendance];
    updatedAttendance.splice(index, 1);
    setAttendance(updatedAttendance);

    const recordToDelete = attendance[index];
    if (recordToDelete) {
      const personKey = `${recordToDelete.name}_${recordToDelete.date}`;
      const remainingRecordsForPerson = updatedAttendance.filter(
        record => record.name === recordToDelete.name && record.date === recordToDelete.date
      );

      if (remainingRecordsForPerson.length === 0 && detectedFaces[personKey]) {
        const updatedDetectedFaces = { ...detectedFaces };
        delete updatedDetectedFaces[personKey];
        setDetectedFaces(updatedDetectedFaces);
      }
    }
  };

  const handleAddRecord = () => {
    const name = document.getElementById('manualName').value;
    const time = document.getElementById('manualTime').value;
    const date = document.getElementById('manualDate').value;
    const status = getAttendanceStatus(new Date(`${date}T${time}`));

    if (name && time && date) {
      setAttendance(prev => [...prev, {
        name: name,
        time: time,
        confidence: "-",
        status: status,
        date: new Date(date).toLocaleDateString()
      }]);
      setShowAddRecordDialog(false); // Close the dialog
    } else {
      alert("All fields are required.");
    }
  };

  const handleEditRecord = (index, field, value) => {
    const updatedAttendance = [...attendance];
    updatedAttendance[index][field] = value;
    setAttendance(updatedAttendance);
  };

  useEffect(() => {
    const resetDetectedFacesAtMidnight = () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        // console.log("Midnight reset - clearing detected faces");
        setDetectedFaces({});
      }
    };

    const midnightCheckInterval = setInterval(resetDetectedFacesAtMidnight, 60000);

    return () => clearInterval(midnightCheckInterval);
  }, []);

  const handleTimeInputChange = (setter) => (e) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value)) {
      setter(value);
    }
  };

  const exportToExcel = () => {
    if (attendance.length === 0) {
      alert("No attendance records to export.");
      return;
    }

    const exportData = attendance.map(record => ({
      Name: record.name,
      Date: formatDate(record.date),
      Time: record.time,
      Confidence: record.confidence || "-",
      Status: record.status
    }));

    const currentDate = new Date().toISOString().split('T')[0];
    const fileName = `attendance_report_${currentDate}.xlsx`;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="flex flex-row gap-4 p-5">
      <div className="w-1/2">
        <div
          className="relative w-full h-[480px] flex justify-center items-center bg-gray overflow-hidden"
        >
          {error ? (
            <p className="absolute text-red-500 text-base">{error}</p>
          ) : (
            <>
              <canvas
                ref={streamCanvasRef}
                className="hidden"
              />

              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute w-full h-full z-1"
              />
              {!isStreamReady && (
                <div className="flex flex-col text-center w-full items-center justify-center">
                  <span>Connecting to camera stream...</span>
                  <Progress value={progress} className="w-[60%] bg-gray-500 [&>div]:bg-white" />
                </div>
              )}
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full z-2"
              />

              <div className="absolute top-2.5 right-2.5 z-3 bg-opacity-50 py-1.5 px-2.5 rounded font-bold text-white"
                style={{ backgroundColor: isAutoDetectionOn ? "rgba(0, 255, 0, 0.3)" : "rgba(255, 0, 0, 0.3)" }}>
                {isAutoDetectionOn ? "Auto Detection: ON" : "Auto Detection: OFF"}
              </div>

              <div className="absolute flex top-2.5 left-2.5 w-35 h-8 z-3 bg-black/50 items-center px-2.5 py-2.5 rounded text-white font-bold">
                <CalendarCheck className="mr-2" />Attendees: {Object.keys(detectedFaces).length}
              </div>
            </>
          )}
        </div>

        <div className="text-center mt-5 text-white">
          {isStreamReady && !labeledDescriptors && "Loading face recognition models..."}
          {isStreamReady && labeledDescriptors && isAutoDetectionOn &&
            `${Object.keys(detectedFaces).length} people recorded today.`}
        </div>

        <div className="flex flex-wrap justify-center gap-2 mt-5">
          <Button
            onClick={captureAndUpload}
            disabled={!isStreamReady}
            variant="outline"
            className={isStreamReady ? "cursor-pointer" : "cursor-not-allowed"}
          >
            Register New Face
          </Button>

          <Button
            onClick={toggleAutoDetection}
            variant="outline"
            disabled={!isStreamReady || !labeledDescriptors}
            className={(isStreamReady && labeledDescriptors) ? "cursor-pointer" : "cursor-not-allowed"}
            style={{
              backgroundColor: isAutoDetectionOn ? "green" : "red"
            }}
          >
            {isAutoDetectionOn ? "Turn Off Auto Detection" : "Turn On Auto Detection"}
          </Button>

          <Button
            onClick={clearAttendance}
            variant="secondary"
            className="cursor-pointer"
          >
            Clear Attendance
          </Button>

          <Button
            onClick={exportToExcel}
            variant="secondary"
            disabled={attendance.length === 0}
            className={attendance.length > 0 ? "cursor-pointer" : "cursor-not-allowed"}
          >
            <FileDown className="h-4 w-4 mr-2" /> Export to Excel
          </Button>

          <Dialog open={showAddRecordDialog} onOpenChange={setShowAddRecordDialog}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="cursor-pointer">
                Add Record Attendance
              </Button>
            </DialogTrigger>
            <DialogContent className="w-96">
              <DialogHeader>
                <DialogTitle>Add Manual Attendance Record</DialogTitle>
                <DialogDescription>
                  Enter the details for the new attendance record.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="manualName">Name</Label>
                  <Input id="manualName" type="text" placeholder="Enter name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manualTime">Time</Label>
                  <Input id="manualTime" type="text" placeholder="Enter time (HH:MM AM/PM)" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manualDate">Date</Label>
                  <Input id="manualDate" type="date" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setShowAddRecordDialog(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleAddRecord}>
                  Add Record
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Popover open={showSettings} onOpenChange={setShowSettings}>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-2" /> Time Settings
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96">
              <Card>
                <CardHeader>
                  <CardTitle>Attendance Time Settings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <h4 className="font-medium">Attendance Config</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="startTime">Start Time</Label>
                          <div className="flex gap-2 items-center w-64">
                            <Input
                              id="startHour"
                              type="number"
                              min="1"
                              max="12"
                              value={startOnTimeHour}
                              onChange={handleTimeInputChange(setStartOnTimeHour)}
                              placeholder="Hour"
                              className="w-16"
                            />
                            <span>:</span>
                            <Input
                              id="startMinute"
                              type="number"
                              min="0"
                              max="59"
                              value={startOnTimeMinute}
                              onChange={handleTimeInputChange(setStartOnTimeMinute)}
                              placeholder="Min"
                              className="w-16"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => toggleAmPm(setStartOnTimeAmPm, startOnTimeAmPm)}
                              className="w-16"
                            >
                              {startOnTimeAmPm}
                            </Button>
                          </div>
                        </div>
                        <br />
                        <div>
                          <Label htmlFor="endTime">End Time</Label>
                          <div className="flex gap-2 items-center w-64">
                            <Input
                              id="endHour"
                              type="number"
                              min="1"
                              max="12"
                              value={endOnTimeHour}
                              onChange={handleTimeInputChange(setEndOnTimeHour)}
                              placeholder="Hour"
                              className="w-16"
                            />
                            <span>:</span>
                            <Input
                              id="endMinute"
                              type="number"
                              min="0"
                              max="59"
                              value={endOnTimeMinute}
                              onChange={handleTimeInputChange(setEndOnTimeMinute)}
                              placeholder="Min"
                              className="w-16"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => toggleAmPm(setEndOnTimeAmPm, endOnTimeAmPm)}
                              className="w-16"
                            >
                              {endOnTimeAmPm}
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="use-current-date"
                            checked={useCurrentDate}
                            onCheckedChange={setUseCurrentDate}
                          />
                          <Label htmlFor="use-current-date">Use Current Date</Label>
                        </div>

                        {!useCurrentDate && (
                          <div>
                            <Label htmlFor="selected-date">Select Date</Label>
                            <Input
                              id="selected-date"
                              type="date"
                              value={formatDate(selectedDate)}
                              onChange={(e) => setSelectedDate(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground mt-4">
                      <p>Settings:</p>
                      <p>On Time: {startOnTimeHour}:{startOnTimeMinute.toString().padStart(2, '0')} {startOnTimeAmPm} - {endOnTimeHour}:{endOnTimeMinute.toString().padStart(2, '0')} {endOnTimeAmPm}</p>
                      <p>Status for new attendees: <span className={getAttendanceStatus() === "On Time" ? "text-green-500 font-bold" : "text-red-500 font-bold"}>{getAttendanceStatus()}</span></p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="w-1/2">
        <h2 className="text-center mb-5 text-white text-xl font-bold">Attendance Table</h2>
        <div className="bg-black/20 p-4 rounded-lg h-[600px] overflow-auto m-2">
          <Table className="w-full text-white">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendance.map((record, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      type="text"
                      value={record.name}
                      onChange={(e) => handleEditRecord(index, 'name', e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={record.date}
                      onChange={(e) => handleEditRecord(index, 'date', e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="text"
                      value={record.time}
                      onChange={(e) => handleEditRecord(index, 'time', e.target.value)}
                    />
                  </TableCell>
                  <TableCell>{record.confidence || "-"}</TableCell>
                  <TableCell>
                    <span className={record.status === "On Time" ? "text-green-500 font-bold" : "text-red-500 font-bold"}>
                      {record.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteAttendanceRecord(index)}
                      className="hover:bg-red-700/20 text-red-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {attendance.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">No attendance records yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default FaceDetection;
