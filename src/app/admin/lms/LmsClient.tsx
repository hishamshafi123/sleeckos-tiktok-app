"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Plus,
  Trash2,
  GraduationCap,
  Play,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  X,
  Users,
  Award,
  BarChart3,
  FileText,
  CircleDot,
  ArrowUpDown,
  Unlock,
  PlusCircle,
  ArrowUp,
  ArrowDown,
  Link,
  Eye,
  Settings,
  FolderPlus,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────

interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface RoleOption {
  key: string;
  label: string;
}

interface QuizQuestion {
  id: string;
  lessonId: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

interface Lesson {
  id: string;
  courseId: string;
  sectionId?: string | null;
  order: number;
  title: string;
  youtubeVideoId: string;
  youtubeUrl?: string; // For compatibility
  stepsMarkdown: string;
  sopMarkdown?: string; // For compatibility
  resources?: any; // JSON string or parsed array
  quizQuestions: QuizQuestion[];
  userProgress?: {
    id: string;
    completedAt: string | null;
    quizScore: number | null;
    watchedPct: number;
    lastPositionSec: number;
  } | null;
  _count?: { progress: number };
}

interface Section {
  id: string;
  courseId: string;
  title: string;
  order: number;
  lessons?: Lesson[];
}

interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  status: string;
  completedAt: string | null;
  user: { id: string; name: string | null; email: string; status?: string };
  course?: any;
  completedLessons?: number;
  completedLessonIds?: string[];
  totalLessons?: number;
}

interface Course {
  id: string;
  title: string;
  description: string | null;
  assignedRoles: string[];
  unlocksToolKey: string | null;
  status: string;
  sections?: Section[];
  lessons?: Lesson[]; // Flat list (unassigned or total depending on API context)
  enrollments?: Enrollment[];
  _count?: { lessons: number; enrollments: number };
}

// ─── Youtube ID Extractor Helper ──────────────────────────

function extractYoutubeVideoId(urlOrId: string): string {
  if (!urlOrId) return "";
  const cleaned = urlOrId.trim();
  if (cleaned.length === 11 && !cleaned.includes("/") && !cleaned.includes(".")) {
    return cleaned; // Already a video ID
  }
  try {
    const urlObj = new URL(cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
    if (urlObj.hostname.includes("youtu.be")) {
      return urlObj.pathname.substring(1);
    }
    if (urlObj.pathname.includes("/shorts/")) {
      const match = urlObj.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    if (urlObj.pathname.includes("/embed/")) {
      const match = urlObj.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    const v = urlObj.searchParams.get("v");
    if (v && v.length === 11) return v;
  } catch {}

  const match = cleaned.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];

  return cleaned;
}

// ─── Props ─────────────────────────────────────────────

interface LmsClientProps {
  currentUser: UserProfile;
  isAdmin: boolean;
  roles: RoleOption[];
  toolKeys: string[];
}

export default function LmsClient({
  currentUser,
  isAdmin,
  roles,
  toolKeys,
}: LmsClientProps) {
  // ── Admin State ──
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [showCreateLesson, setShowCreateLesson] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [showAddQuiz, setShowAddQuiz] = useState<string | null>(null); // lessonId
  const [adminTab, setAdminTab] = useState<"courses" | "dashboard">("courses");

  // Course form
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDesc, setCourseDesc] = useState("");
  const [courseRoles, setCourseRoles] = useState<string[]>([]);
  const [courseUnlock, setCourseUnlock] = useState("");

  // Section form
  const [sectionTitle, setSectionTitle] = useState("");

  // Lesson form
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonYoutube, setLessonYoutube] = useState("");
  const [lessonSop, setLessonSop] = useState("");
  const [lessonSectionId, setLessonSectionId] = useState("");
  const [lessonResources, setLessonResources] = useState<{ title: string; url: string }[]>([]);
  const [newResourceTitle, setNewResourceTitle] = useState("");
  const [newResourceUrl, setNewResourceUrl] = useState("");

  // Quiz form
  const [quizPrompt, setQuizPrompt] = useState("");
  const [quizOptions, setQuizOptions] = useState(["", "", "", ""]);
  const [quizCorrect, setQuizCorrect] = useState(0);

  // Dashboard
  const [dashboard, setDashboard] = useState<any[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // ── Trainee State ──
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true);
  const [activeCourse, setActiveCourse] = useState<any | null>(null);
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<any | null>(null);

  // ── YouTube Player Ref & Hooks ──
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const [playerLoading, setPlayerLoading] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Load YouTube API script
  useEffect(() => {
    if (typeof window !== "undefined" && !(window as any).YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // ── Data Fetching ──

  useEffect(() => {
    if (isAdmin) {
      fetchCourses();
    } else {
      fetchEnrollments();
    }
  }, [isAdmin]);

  const fetchCourses = async () => {
    setCoursesLoading(true);
    try {
      const res = await fetch("/api/lms/courses");
      const data = await res.json();
      if (res.ok) setCourses(data);
    } catch (err) {
      console.error(err);
    } finally {
      setCoursesLoading(false);
    }
  };

  const fetchCourseDetails = async (courseId: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/lms/courses/${courseId}`);
      const data = await res.json();
      if (res.ok) {
        // Ensure stepsMarkdown and youtubeVideoId fallback safely if DB properties differ
        const mappedLessons = data.lessons?.map((l: any) => ({
          ...l,
          youtubeVideoId: l.youtubeVideoId || extractYoutubeVideoId(l.youtubeUrl || ""),
          stepsMarkdown: l.stepsMarkdown || l.sopMarkdown || "",
          resources: typeof l.resources === "string" ? JSON.parse(l.resources) : (l.resources || []),
        })) || [];
        const mappedSections = data.sections?.map((s: any) => ({
          ...s,
          lessons: s.lessons?.map((l: any) => ({
            ...l,
            youtubeVideoId: l.youtubeVideoId || extractYoutubeVideoId(l.youtubeUrl || ""),
            stepsMarkdown: l.stepsMarkdown || l.sopMarkdown || "",
            resources: typeof l.resources === "string" ? JSON.parse(l.resources) : (l.resources || []),
          })) || [],
        })) || [];

        setSelectedCourse({
          ...data,
          lessons: mappedLessons,
          sections: mappedSections,
        });
      } else {
        toast.error(data.error || "Failed to load course");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const fetchEnrollments = async () => {
    setEnrollmentsLoading(true);
    try {
      const res = await fetch("/api/lms/courses");
      const data = await res.json();
      if (res.ok) setEnrollments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setEnrollmentsLoading(false);
    }
  };

  const fetchDashboard = async () => {
    setDashboardLoading(true);
    try {
      const res = await fetch("/api/lms/enrollments");
      const data = await res.json();
      if (res.ok) setDashboard(data);
    } catch (err) {
      console.error(err);
    } finally {
      setDashboardLoading(false);
    }
  };

  const fetchLessonDetail = async (courseId: string, lessonId: string) => {
    setLessonLoading(true);
    setQuizResult(null);
    setQuizAnswers([]);
    setPlayerLoading(true);
    setPlayerError(null);
    try {
      const res = await fetch(`/api/lms/courses/${courseId}/lessons/${lessonId}`);
      const data = await res.json();
      if (res.ok) {
        const lesson = {
          ...data,
          youtubeVideoId: data.youtubeVideoId || extractYoutubeVideoId(data.youtubeUrl || ""),
          stepsMarkdown: data.stepsMarkdown || data.sopMarkdown || "",
          resources: typeof data.resources === "string" ? JSON.parse(data.resources) : (data.resources || []),
        };
        setActiveLesson(lesson);
        if (lesson.quizQuestions?.length > 0) {
          setQuizAnswers(new Array(lesson.quizQuestions.length).fill(-1));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLessonLoading(false);
    }
  };

  // ── YouTube Progress Tracking Logic ──

  const startTracking = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== "function" || !activeLesson || !activeCourse) return;

      try {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        if (!duration) return;

        const watchedPct = Math.round((currentTime / duration) * 100);

        const res = await fetch(`/api/lms/courses/${activeCourse.course.id}/lessons/${activeLesson.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SAVE_PROGRESS",
            watchedPct,
            lastPositionSec: currentTime,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          // If completed automatically, alert trainee
          if (data.completedAt && !activeLesson.userProgress?.completedAt) {
            toast.success("Lesson completed automatically (90% watched)!");
            fetchLessonDetail(activeCourse.course.id, activeLesson.id);
            fetchEnrollments();
          }
        }
      } catch (err) {
        console.error("Watch progress tracking error:", err);
      }
    }, 4000);
  };

  const stopTracking = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Mount Player API Frame
  useEffect(() => {
    if (!activeLesson) return;

    let playerInstance: any = null;
    const initPlayer = () => {
      if (typeof window === "undefined" || !(window as any).YT || !(window as any).YT.Player) {
        setTimeout(initPlayer, 400);
        return;
      }

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
      }

      playerInstance = new (window as any).YT.Player("lms-yt-player", {
        videoId: activeLesson.youtubeVideoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          modestbranding: 1,
          rel: 0,
          controls: 1,
          playsinline: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: (event: any) => {
            playerRef.current = event.target;
            setPlayerLoading(false);
            const resumeSec = activeLesson.userProgress?.lastPositionSec || 0;
            if (resumeSec > 0) {
              event.target.seekTo(resumeSec, true);
            }
          },
          onStateChange: (event: any) => {
            if (event.data === 1) {
              startTracking();
            } else {
              stopTracking();
            }
          },
          onError: () => {
            setPlayerError("Video unavailable or restricted embed settings.");
            setPlayerLoading(false);
          },
        },
      });
    };

    const timer = setTimeout(initPlayer, 200);
    return () => {
      clearTimeout(timer);
      stopTracking();
      if (playerInstance) {
        try {
          playerInstance.destroy();
        } catch {}
      }
    };
  }, [activeLesson?.id]);

  // ── Admin Actions ──

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseTitle || courseRoles.length === 0) {
      toast.error("Title and at least one assigned role are required.");
      return;
    }

    try {
      const res = await fetch("/api/lms/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: courseTitle,
          description: courseDesc || null,
          assignedRoles: courseRoles,
          unlocksToolKey: courseUnlock || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Course created!");
      setShowCreateCourse(false);
      setCourseTitle("");
      setCourseDesc("");
      setCourseRoles([]);
      setCourseUnlock("");
      fetchCourses();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    if (!confirm("Delete this course and all its lessons? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/lms/courses/${courseId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Course deleted");
      setSelectedCourse(null);
      fetchCourses();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse || !sectionTitle) return;

    try {
      const res = await fetch(`/api/lms/courses/${selectedCourse.id}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: sectionTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Section added!");
      setShowAddSection(false);
      setSectionTitle("");
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!selectedCourse || !confirm("Delete this section? Lessons inside will be unassigned.")) return;
    try {
      const res = await fetch(`/api/lms/courses/${selectedCourse.id}/sections/${sectionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete section");
      toast.success("Section deleted");
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse || !lessonTitle || !lessonYoutube) return;

    try {
      const videoId = extractYoutubeVideoId(lessonYoutube);
      const res = await fetch(`/api/lms/courses/${selectedCourse.id}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: lessonTitle,
          youtubeVideoId: videoId,
          stepsMarkdown: lessonSop,
          sectionId: lessonSectionId || null,
          resources: lessonResources,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Lesson added!");
      setShowCreateLesson(false);
      setLessonTitle("");
      setLessonYoutube("");
      setLessonSop("");
      setLessonSectionId("");
      setLessonResources([]);
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteLesson = async (lessonId: string) => {
    if (!selectedCourse || !confirm("Delete this lesson?")) return;
    try {
      const res = await fetch(
        `/api/lms/courses/${selectedCourse.id}/lessons/${lessonId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Lesson deleted");
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAddQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddQuiz || !selectedCourse) return;

    const validOptions = quizOptions.filter((o) => o.trim());
    if (!quizPrompt || validOptions.length < 2) {
      toast.error("Prompt and at least 2 options are required.");
      return;
    }

    try {
      const res = await fetch(
        `/api/lms/courses/${selectedCourse.id}/lessons/${showAddQuiz}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ADD_QUIZ",
            prompt: quizPrompt,
            options: validOptions,
            correctIndex: quizCorrect,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Quiz question added!");
      setShowAddQuiz(null);
      setQuizPrompt("");
      setQuizOptions(["", "", "", ""]);
      setQuizCorrect(0);
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteQuiz = async (lessonId: string, questionId: string) => {
    if (!selectedCourse) return;
    try {
      const res = await fetch(
        `/api/lms/courses/${selectedCourse.id}/lessons/${lessonId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "DELETE_QUIZ", questionId }),
        }
      );
      if (!res.ok) throw new Error("Failed to delete question");
      toast.success("Question removed");
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleEnrollUsers = async (courseId: string) => {
    try {
      const res = await fetch("/api/lms/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Enrolled ${data.enrolled} new user(s) (${data.total} total matched)`);
      fetchCourseDetails(courseId);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Move sections / reorder
  const handleMoveSection = async (sectionId: string, direction: "up" | "down") => {
    if (!selectedCourse || !selectedCourse.sections) return;
    const sects = [...selectedCourse.sections];
    const index = sects.findIndex((s) => s.id === sectionId);
    if (index === -1) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === sects.length - 1) return;

    const targetIdx = direction === "up" ? index - 1 : index + 1;
    const temp = sects[index];
    sects[index] = sects[targetIdx];
    sects[targetIdx] = temp;

    try {
      const res = await fetch(`/api/lms/courses/${selectedCourse.id}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REORDER",
          sectionIds: sects.map((s) => s.id),
        }),
      });
      if (!res.ok) throw new Error("Failed to reorder sections");
      toast.success("Sections order saved");
      fetchCourseDetails(selectedCourse.id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ── Trainee Actions ──

  const handleMarkComplete = async () => {
    if (!activeLesson || !activeCourse) return;
    try {
      const res = await fetch(
        `/api/lms/courses/${activeCourse.course.id}/lessons/${activeLesson.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "MARK_COMPLETE" }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Lesson completed!");
      fetchLessonDetail(activeCourse.course.id, activeLesson.id);
      fetchEnrollments();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!activeLesson || !activeCourse) return;
    if (quizAnswers.some((a) => a === -1)) {
      toast.error("Please answer all questions before submitting.");
      return;
    }

    try {
      const res = await fetch(
        `/api/lms/courses/${activeCourse.course.id}/lessons/${activeLesson.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "SUBMIT_QUIZ", answers: quizAnswers }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setQuizResult(data);
      if (data.passed) {
        toast.success(`Quiz passed! ${data.score}/${data.total} correct`);
        fetchLessonDetail(activeCourse.course.id, activeLesson.id);
        fetchEnrollments();
      } else {
        toast.error(`Quiz not passed. ${data.score}/${data.total} correct. All answers must be correct.`);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Trainee previous/next lesson calculators
  const getPrevAndNextLessons = () => {
    if (!activeCourse || !activeLesson) return { prev: null, next: null };
    const list: any[] = [];
    activeCourse.course.sections?.forEach((s: any) => {
      s.lessons?.forEach((l: any) => list.push(l));
    });
    activeCourse.course.lessons?.filter((l: any) => !l.sectionId).forEach((l: any) => list.push(l));

    const currentIdx = list.findIndex((l) => l.id === activeLesson.id);
    return {
      prev: currentIdx > 0 ? list[currentIdx - 1] : null,
      next: currentIdx !== -1 && currentIdx < list.length - 1 ? list[currentIdx + 1] : null,
    };
  };

  const { prev: prevLesson, next: nextLesson } = getPrevAndNextLessons();

  // Resource Attachments builders
  const handleAddResourceItem = () => {
    if (!newResourceTitle || !newResourceUrl) {
      toast.error("Resource title and link url are required");
      return;
    }
    setLessonResources((prev) => [...prev, { title: newResourceTitle, url: newResourceUrl }]);
    setNewResourceTitle("");
    setNewResourceUrl("");
  };

  const handleRemoveResourceItem = (idx: number) => {
    setLessonResources((prev) => prev.filter((_, i) => i !== idx));
  };

  // ════════════════════════════════════════════════════════
  // ████  ADMIN VIEW
  // ════════════════════════════════════════════════════════

  if (isAdmin) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 text-zinc-100 bg-[#09090b]">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-[#27272a] pb-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight">LMS Academy Builder</h1>
            <p className="text-xs text-zinc-400">
              Build training courses, assign by role, gate tool access behind completion.
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-2 border-b border-[#27272a]">
          <button
            onClick={() => {
              setAdminTab("courses");
              setSelectedCourse(null);
            }}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              adminTab === "courses"
                ? "border-[#2563eb] text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Course Builder
          </button>
          <button
            onClick={() => {
              setAdminTab("dashboard");
              fetchDashboard();
            }}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              adminTab === "dashboard"
                ? "border-[#2563eb] text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Completion Dashboard
          </button>
        </div>

        {/* ── Courses Tab ── */}
        {adminTab === "courses" && !selectedCourse && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: "Active Courses", value: courses.filter((c) => c.status === "active").length },
                { label: "Total Lessons", value: courses.reduce((a, c) => a + (c._count?.lessons || 0), 0) },
                { label: "Total Enrollments", value: courses.reduce((a, c) => a + (c._count?.enrollments || 0), 0) },
              ].map((s, i) => (
                <div key={i} className="border border-[#27272a] rounded-md p-4 bg-[#09090b] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">{s.label}</span>
                  <div className="text-2xl font-bold tracking-tight">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Course List */}
            <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
              <div className="flex justify-between items-center pb-3 border-b border-[#27272a] mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">All Courses</h2>
                <button
                  onClick={() => setShowCreateCourse(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Course
                </button>
              </div>

              {coursesLoading ? (
                <div className="text-zinc-500 py-10 text-center text-xs animate-pulse">Loading courses...</div>
              ) : courses.length === 0 ? (
                <div className="text-zinc-500 py-10 text-center text-xs">
                  No courses created yet. Build your first training course above.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#27272a] text-zinc-500 font-bold uppercase tracking-wider">
                        <th className="py-2.5">Course Title</th>
                        <th className="py-2.5">Assigned Roles</th>
                        <th className="py-2.5">Lessons</th>
                        <th className="py-2.5">Enrollments</th>
                        <th className="py-2.5">Unlocks</th>
                        <th className="py-2.5">Status</th>
                        <th className="py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#27272a]">
                      {courses.map((course) => (
                        <tr key={course.id} className="hover:bg-zinc-900/50 transition text-zinc-300">
                          <td className="py-3 font-semibold text-zinc-100">{course.title}</td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {course.assignedRoles.map((r) => (
                                <span
                                  key={r}
                                  className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-zinc-800 text-zinc-400 border border-zinc-700/50 rounded-full"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3">{course._count?.lessons || 0}</td>
                          <td className="py-3">{course._count?.enrollments || 0}</td>
                          <td className="py-3">
                            {course.unlocksToolKey ? (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-emerald-950/20 text-emerald-400 border border-emerald-900/40 rounded-full flex items-center gap-0.5 w-fit">
                                <Unlock className="w-2.5 h-2.5" />
                                  {course.unlocksToolKey}
                              </span>
                            ) : (
                              <span className="text-zinc-600 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                course.status === "active"
                                  ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                                  : "bg-zinc-900/20 text-zinc-400 border-zinc-900"
                              }`}
                            >
                              {course.status}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => fetchCourseDetails(course.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#27272a] text-zinc-200 border border-[#3f3f46] rounded-md text-[10px] font-bold hover:text-white hover:bg-zinc-800 transition"
                            >
                              Manage
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Selected Course Detail ── */}
        {adminTab === "courses" && selectedCourse && (
          <div className="space-y-6">
            {/* Breadcrumb */}
            <div className="flex justify-between items-center border-b border-[#27272a] pb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectedCourse(null);
                    fetchCourses();
                  }}
                  className="text-xs text-zinc-400 hover:text-white font-semibold"
                >
                  &larr; Back to Courses
                </button>
                <div className="h-4 w-px bg-zinc-700" />
                <h2 className="text-base font-bold tracking-tight text-white">
                  {selectedCourse.title}
                </h2>
                {selectedCourse.unlocksToolKey && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-950/20 text-emerald-400 border border-emerald-900/40 flex items-center gap-0.5">
                    <Unlock className="w-2.5 h-2.5" />
                    Unlocks: {selectedCourse.unlocksToolKey}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddSection(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md text-[10px] font-bold hover:bg-zinc-700 transition"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Add Section
                </button>
                <button
                  onClick={() => handleEnrollUsers(selectedCourse.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md text-[10px] font-bold hover:bg-zinc-700 transition"
                >
                  <Users className="w-3.5 h-3.5" />
                  Enroll Matching Users
                </button>
                <button
                  onClick={() => handleDeleteCourse(selectedCourse.id)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-950/20 border border-red-900/40 text-red-400 rounded-md text-[10px] font-bold hover:bg-red-950/40 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Course
                </button>
              </div>
            </div>

            {selectedCourse.description && (
              <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
                {selectedCourse.description}
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Lessons and Sections Column */}
              <div className="lg:col-span-2 space-y-6">
                {/* Course Index Builder */}
                <div className="border border-[#27272a] rounded-lg bg-[#09090b] p-5 space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b border-[#27272a]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Sections & Course Hierarchy
                    </h3>
                    <button
                      onClick={() => setShowCreateLesson(true)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-[#2563eb] text-white rounded-md text-[10px] font-bold hover:bg-blue-700 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Lesson
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Render sections list */}
                    {selectedCourse.sections?.map((sect, idx) => (
                      <div key={sect.id} className="border border-zinc-850 rounded-lg p-3 bg-zinc-950/20 space-y-3">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-300">Section: {sect.title}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleMoveSection(sect.id, "up")}
                              disabled={idx === 0}
                              className="p-1 hover:bg-zinc-800 rounded disabled:opacity-30"
                            >
                              <ArrowUp className="w-3 h-3 text-zinc-500" />
                            </button>
                            <button
                              onClick={() => handleMoveSection(sect.id, "down")}
                              disabled={idx === (selectedCourse.sections?.length || 0) - 1}
                              className="p-1 hover:bg-zinc-800 rounded disabled:opacity-30"
                            >
                              <ArrowDown className="w-3 h-3 text-zinc-500" />
                            </button>
                            <button
                              onClick={() => handleDeleteSection(sect.id)}
                              className="p-1 text-zinc-600 hover:text-red-400 rounded"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Lessons in section */}
                        <div className="space-y-2 pl-3 border-l border-zinc-900">
                          {sect.lessons && sect.lessons.length > 0 ? (
                            sect.lessons.map((les, lIdx) => (
                              <div
                                key={les.id}
                                className="bg-[#121214]/50 border border-zinc-850 rounded p-3 text-xs flex items-center justify-between group"
                              >
                                <div className="space-y-1 pr-4 max-w-[70%]">
                                  <p className="font-semibold text-zinc-200">
                                    {lIdx + 1}. {les.title}
                                  </p>
                                  <p className="text-[10px] text-zinc-500 font-mono truncate">
                                    Video ID: {les.youtubeVideoId}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setShowAddQuiz(les.id)}
                                    className="px-2 py-0.5 text-[9px] font-bold bg-zinc-800 text-zinc-400 hover:text-white rounded border border-zinc-700"
                                  >
                                    Quiz ({les.quizQuestions?.length || 0})
                                  </button>
                                  <button
                                    onClick={() => handleDeleteLesson(les.id)}
                                    className="p-1 text-zinc-600 hover:text-red-400 transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-[10px] text-zinc-600 italic">No lessons assigned to this section yet.</p>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Unassigned lessons list */}
                    {selectedCourse.lessons && selectedCourse.lessons.length > 0 ? (
                      <div className="space-y-2 border border-dashed border-zinc-850 p-3 rounded-lg bg-zinc-950/5">
                        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Unassigned lessons</h4>
                        <div className="space-y-2 pl-3 border-l border-zinc-900">
                          {selectedCourse.lessons.map((les, lIdx) => (
                            <div
                              key={les.id}
                              className="bg-[#121214]/50 border border-zinc-850 rounded p-3 text-xs flex items-center justify-between"
                            >
                              <div className="space-y-1 pr-4 max-w-[70%]">
                                <p className="font-semibold text-zinc-200">
                                  {lIdx + 1}. {les.title}
                                </p>
                                <p className="text-[10px] text-zinc-500 font-mono truncate">
                                  Video ID: {les.youtubeVideoId}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setShowAddQuiz(les.id)}
                                  className="px-2 py-0.5 text-[9px] font-bold bg-zinc-800 text-zinc-400 hover:text-white rounded border border-zinc-700"
                                >
                                  Quiz ({les.quizQuestions?.length || 0})
                                </button>
                                <button
                                  onClick={() => handleDeleteLesson(les.id)}
                                  className="p-1 text-zinc-600 hover:text-red-400 transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Enrollments Sidebar */}
              <div className="space-y-4">
                <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-2">
                    <Users className="w-3.5 h-3.5" />
                    Enrolled Users ({selectedCourse.enrollments?.length || 0})
                  </h3>

                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider pb-1">
                    Assigned Roles: {selectedCourse.assignedRoles.join(", ")}
                  </div>

                  {(!selectedCourse.enrollments || selectedCourse.enrollments.length === 0) ? (
                    <div className="text-zinc-600 text-[10px] italic py-4 text-center">
                      No users enrolled. Click "Enroll Matching Users" to auto-assign.
                    </div>
                  ) : (
                    <div className="space-y-2 overflow-y-auto max-h-[400px]">
                      {selectedCourse.enrollments.map((e: any) => (
                        <div key={e.id} className="flex justify-between items-center text-xs p-2 bg-[#121214] rounded-md border border-[#27272a]/20">
                          <div>
                            <div className="font-semibold text-zinc-100">{e.user.name || e.user.email}</div>
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border uppercase ${
                              e.status === "completed"
                                ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                                : e.status === "in_progress"
                                ? "bg-blue-950/20 text-blue-400 border-blue-900/50"
                                : "bg-zinc-900/20 text-zinc-400 border-zinc-800"
                            }`}
                          >
                            {e.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Dashboard Tab ── */}
        {adminTab === "dashboard" && (
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-3 mb-4">
              <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
              Per-User Course Completion
            </h3>

            {dashboardLoading ? (
              <div className="text-zinc-500 py-10 text-center text-xs">Loading dashboard...</div>
            ) : dashboard.length === 0 ? (
              <div className="text-zinc-500 py-10 text-center text-xs">No enrollment data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] text-zinc-500 font-bold uppercase tracking-wider">
                      <th className="py-2.5">User</th>
                      <th className="py-2.5">Course</th>
                      <th className="py-2.5">Progress</th>
                      <th className="py-2.5">Status</th>
                      <th className="py-2.5">Unlocks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]">
                    {dashboard.map((row: any) => (
                      <tr key={row.id} className="hover:bg-zinc-900/50 transition text-zinc-300">
                        <td className="py-3">
                          <div className="font-semibold text-zinc-100">{row.user.name || row.user.email}</div>
                          <div className="text-[9px] text-zinc-500 uppercase">{row.user.status}</div>
                        </td>
                        <td className="py-3 text-zinc-200">{row.course.title}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#2563eb] rounded-full transition-all"
                                style={{
                                  width: `${row.totalLessons > 0 ? (row.completedLessons / row.totalLessons) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-zinc-400 font-bold">
                              {row.completedLessons}/{row.totalLessons}
                            </span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              row.status === "completed"
                                ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                                : row.status === "in_progress"
                                ? "bg-blue-950/20 text-blue-400 border-blue-900/50"
                                : "bg-zinc-900/20 text-zinc-400 border-zinc-800"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="py-3">
                          {row.course.unlocksToolKey ? (
                            <span className="text-[9px] font-bold text-emerald-400">{row.course.unlocksToolKey}</span>
                          ) : (
                            <span className="text-zinc-600 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Create Course Modal ── */}
        {showCreateCourse && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <form
              onSubmit={handleCreateCourse}
              className="w-full max-w-md border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">Create Course</h3>
                <button type="button" onClick={() => setShowCreateCourse(false)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Course Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Editor Onboarding"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Description</label>
                <textarea
                  placeholder="What this course covers..."
                  value={courseDesc}
                  onChange={(e) => setCourseDesc(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-16 resize-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Assigned Roles</label>
                <div className="flex flex-wrap gap-2">
                  {roles.map((r) => (
                    <label key={r.key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={courseRoles.includes(r.key)}
                        onChange={() => {
                          setCourseRoles((prev) =>
                            prev.includes(r.key) ? prev.filter((k) => k !== r.key) : [...prev, r.key]
                          );
                        }}
                        className="accent-blue-500"
                      />
                      <span className="text-xs text-zinc-300">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Unlocks Tool on Completion (optional)
                </label>
                <select
                  value={courseUnlock}
                  onChange={(e) => setCourseUnlock(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="">No tool unlock</option>
                  {toolKeys.map((tk) => (
                    <option key={tk} value={tk}>
                      {tk}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 justify-end pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateCourse(false)}
                  className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Add Section Modal ── */}
        {showAddSection && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <form
              onSubmit={handleCreateSection}
              className="w-full max-w-sm border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">Add Course Section</h3>
                <button type="button" onClick={() => setShowAddSection(false)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Section Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Editing Workflows"
                  value={sectionTitle}
                  onChange={(e) => setSectionTitle(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-3 justify-end pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddSection(false)}
                  className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Create Lesson Modal ── */}
        {showCreateLesson && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in zoom-in duration-200">
            <form
              onSubmit={handleCreateLesson}
              className="w-full max-w-lg border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4 my-8"
            >
              <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">Add Lesson</h3>
                <button type="button" onClick={() => setShowCreateLesson(false)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Lesson Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Introduction to Clip Mixer"
                    value={lessonTitle}
                    onChange={(e) => setLessonTitle(e.target.value)}
                    className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Assign Section</label>
                  <select
                    value={lessonSectionId}
                    onChange={(e) => setLessonSectionId(e.target.value)}
                    className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 text-zinc-300"
                  >
                    <option value="">Unassigned (No Section)</option>
                    {selectedCourse?.sections?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">YouTube Video URL / ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. https://youtube.com/watch?v=..."
                  value={lessonYoutube}
                  onChange={(e) => setLessonYoutube(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                />
                {lessonYoutube && (
                  <div className="mt-2 p-2 bg-zinc-950 border border-zinc-850 rounded flex gap-3 items-center">
                    <img
                      src={`https://img.youtube.com/vi/${extractYoutubeVideoId(lessonYoutube)}/mqdefault.jpg`}
                      alt="YouTube Preview"
                      className="w-20 rounded border border-zinc-800"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                    <div className="text-[10px] text-zinc-500">
                      <p className="font-bold text-zinc-300">Thumbnail Preview</p>
                      <p className="font-mono mt-0.5">Video ID: {extractYoutubeVideoId(lessonYoutube)}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">SOP Written Steps (Markdown)</label>
                <textarea
                  placeholder="# Standard Operating Procedure&#10;&#10;Write your markdown SOP here..."
                  value={lessonSop}
                  onChange={(e) => setLessonSop(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-32 resize-y font-mono"
                />
              </div>

              {/* Resource Attachments array builder */}
              <div className="border border-zinc-850 bg-zinc-950/20 p-3 rounded-lg space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500">Resource Attachments</label>
                {lessonResources.length > 0 && (
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {lessonResources.map((res, rIdx) => (
                      <div key={rIdx} className="flex justify-between items-center text-[10px] bg-zinc-950 p-1.5 rounded border border-zinc-900">
                        <span className="truncate max-w-[70%] font-semibold text-zinc-300">{res.title} ({res.url})</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveResourceItem(rIdx)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Doc Title (e.g. Asset Library)"
                    value={newResourceTitle}
                    onChange={(e) => setNewResourceTitle(e.target.value)}
                    className="bg-[#121214] border border-[#27272a] rounded px-2.5 py-1 text-xs focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="URL Link"
                      value={newResourceUrl}
                      onChange={(e) => setNewResourceUrl(e.target.value)}
                      className="flex-1 bg-[#121214] border border-[#27272a] rounded px-2.5 py-1 text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddResourceItem}
                      className="px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-750 text-xs font-bold"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setShowCreateLesson(false)}
                  className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition"
                >
                  Add Lesson
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Add Quiz Modal ── */}
        {showAddQuiz && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <form
              onSubmit={handleAddQuiz}
              className="w-full max-w-md border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">Add Quiz Question</h3>
                <button type="button" onClick={() => setShowAddQuiz(null)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Question Prompt</label>
                <textarea
                  required
                  placeholder="What is the maximum clip duration for the mixer?"
                  value={quizPrompt}
                  onChange={(e) => setQuizPrompt(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-16 resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Answer Options</label>
                {quizOptions.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct"
                      checked={quizCorrect === i}
                      onChange={() => setQuizCorrect(i)}
                      className="accent-emerald-500"
                    />
                    <input
                      type="text"
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const newOpts = [...quizOptions];
                        newOpts[i] = e.target.value;
                        setQuizOptions(newOpts);
                      }}
                      className="flex-1 bg-[#121214] border border-[#27272a] rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                ))}
                <p className="text-[9px] text-zinc-500">Select the radio button next to the correct answer.</p>
              </div>

              <div className="flex gap-3 justify-end pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddQuiz(null)}
                  className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition"
                >
                  Add Question
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // ████  TRAINEE VIEW
  // ════════════════════════════════════════════════════════

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Active Lesson Player */}
      {activeLesson && activeCourse ? (
        <div className="space-y-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setActiveLesson(null);
                setActiveCourse(null);
                setQuizResult(null);
                fetchEnrollments();
              }}
              className="text-xs text-zinc-400 hover:text-white font-semibold"
            >
              &larr; Back to Courses
            </button>
            <div className="h-4 w-px bg-zinc-700" />
            <span className="text-xs text-zinc-500">{activeCourse.course.title}</span>
            <ChevronRight className="w-3 h-3 text-zinc-600" />
            <span className="text-xs text-zinc-200 font-semibold">{activeLesson.title}</span>
          </div>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Left Sidebar Navigation */}
            <div className="w-full lg:w-72 flex-shrink-0 space-y-6 border-r border-zinc-900 pr-6">
              <div className="border border-[#27272a] rounded-xl p-4 bg-zinc-950/20 space-y-3">
                <div>
                  <h3 className="text-xs font-bold text-zinc-300 truncate">{activeCourse.course.title}</h3>
                  <p className="text-[10px] text-zinc-500 mt-1">Training Program</p>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-zinc-400 font-bold uppercase">
                    <span>Progress</span>
                    <span>{activeCourse.completedLessons} / {activeCourse.totalLessons} Lessons</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((activeCourse.completedLessons / activeCourse.totalLessons) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Sections list in Sidebar */}
              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {activeCourse.course.sections?.map((sect: any) => (
                  <div key={sect.id} className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5 text-zinc-600" />
                      {sect.title}
                    </h4>
                    <div className="space-y-1 pl-2 border-l border-zinc-850">
                      {sect.lessons?.map((les: any) => {
                        const isComplete = activeCourse.completedLessonIds?.includes(les.id) || les.id === activeLesson.id && activeLesson.userProgress?.completedAt;
                        const isActive = activeLesson.id === les.id;
                        return (
                          <button
                            key={les.id}
                            onClick={() => fetchLessonDetail(activeCourse.course.id, les.id)}
                            className={`w-full flex items-center justify-between p-2 rounded text-left text-xs transition ${
                              isActive
                                ? "bg-zinc-900 text-white font-semibold border border-zinc-800"
                                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-950"
                            }`}
                          >
                            <span className="truncate pr-2">{les.title}</span>
                            {isComplete ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                            ) : (
                              <CircleDot className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Unassigned lessons in Sidebar */}
                {activeCourse.course.lessons?.filter((l: any) => !l.sectionId).length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Uncategorized Lessons
                    </h4>
                    <div className="space-y-1 pl-2 border-l border-zinc-850">
                      {activeCourse.course.lessons
                        ?.filter((l: any) => !l.sectionId)
                        .map((les: any) => {
                          const isComplete = activeCourse.completedLessonIds?.includes(les.id) || les.id === activeLesson.id && activeLesson.userProgress?.completedAt;
                          const isActive = activeLesson.id === les.id;
                          return (
                            <button
                              key={les.id}
                              onClick={() => fetchLessonDetail(activeCourse.course.id, les.id)}
                              className={`w-full flex items-center justify-between p-2 rounded text-left text-xs transition ${
                                isActive
                                  ? "bg-zinc-900 text-white font-semibold border border-zinc-800"
                                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-950"
                              }`}
                            >
                              <span className="truncate pr-2">{les.title}</span>
                              {isComplete ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                              ) : (
                                <CircleDot className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Main Lesson Body */}
            <div className="flex-1 space-y-6">
              {/* Video Player Responsive Frame */}
              <div className="border border-[#27272a] rounded-xl overflow-hidden bg-black aspect-video relative shadow-xl">
                {playerLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 space-y-2">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Initializing Player...</p>
                  </div>
                )}
                {playerError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 p-6 text-center space-y-3">
                    <p className="text-red-400 text-xs font-semibold">{playerError}</p>
                    <p className="text-[10px] text-zinc-500">Hint: Verify your YouTube URL is correct, and that the video is public.</p>
                  </div>
                ) : null}
                <div id="lms-yt-player" className="w-full h-full" />
              </div>

              {/* Steps Markdown */}
              {activeLesson.stepsMarkdown && (
                <div className="border border-[#27272a] rounded-xl bg-zinc-950/20 p-6 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-3">
                    <FileText className="w-4 h-4 text-blue-500" />
                    Standard Operating Procedure
                  </h3>
                  <div className="prose prose-invert max-w-none text-zinc-300 text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-zinc-100 [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:text-zinc-200 [&_h2]:mt-5 [&_h2]:mb-2.5 [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-black [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-3 [&_li]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400 [&_blockquote]:italic">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {activeLesson.stepsMarkdown}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Resources list */}
              {activeLesson.resources && Array.isArray(activeLesson.resources) && activeLesson.resources.length > 0 && (
                <div className="border border-[#27272a] rounded-xl bg-zinc-950/10 p-5 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Link className="w-3.5 h-3.5 text-zinc-500" />
                    Lesson Attachments & Resources
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {activeLesson.resources.map((res: any, idx: number) => (
                      <a
                        key={idx}
                        href={res.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 text-xs text-zinc-300 hover:text-white bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-850 hover:border-zinc-700 transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-zinc-500" />
                        <span className="font-semibold">{res.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Quiz or Mark Complete Panel */}
              <div className="border border-[#27272a] rounded-xl bg-[#09090b] p-6 space-y-4 shadow-lg">
                {activeLesson.userProgress?.completedAt ? (
                  <div className="flex items-center gap-3 p-4 bg-emerald-950/10 border border-emerald-900/30 rounded-md">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-400">Lesson Completed</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        Completed on {new Date(activeLesson.userProgress.completedAt).toLocaleDateString()}
                        {activeLesson.userProgress.quizScore !== null && ` • Quiz score: ${activeLesson.userProgress.quizScore}/${activeLesson.quizQuestions.length} correct`}
                      </p>
                    </div>
                  </div>
                ) : activeLesson.quizQuestions && activeLesson.quizQuestions.length > 0 ? (
                  <>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-3">
                      <GraduationCap className="w-3.5 h-3.5 text-amber-500" />
                      Checkpoint Quiz — Answer all questions correctly to complete this lesson
                    </h3>

                    <div className="space-y-4">
                      {activeLesson.quizQuestions.map((q: QuizQuestion, qi: number) => (
                        <div key={q.id} className="space-y-2">
                          <p className="text-xs font-semibold text-zinc-200">
                            {qi + 1}. {q.prompt}
                          </p>
                          <div className="space-y-1.5 pl-4">
                            {q.options.map((opt: string, oi: number) => {
                              const isSelected = quizAnswers[qi] === oi;
                              const showResult = quizResult?.results?.[qi];
                              let optClass = "bg-[#121214] border-[#27272a] text-zinc-300";

                              if (showResult) {
                                if (oi === showResult.correctAnswer) {
                                  optClass = "bg-emerald-950/20 border-emerald-900/40 text-emerald-400";
                                } else if (isSelected && !showResult.correct) {
                                  optClass = "bg-red-950/20 border-red-900/40 text-red-400";
                                }
                              } else if (isSelected) {
                                optClass = "bg-blue-950/20 border-blue-900/40 text-blue-400";
                              }

                              return (
                                <label
                                  key={oi}
                                  className={`flex items-center gap-2.5 p-2.5 border rounded-md cursor-pointer transition hover:border-zinc-650 ${optClass}`}
                                >
                                  <input
                                    type="radio"
                                    name={`quiz-${qi}`}
                                    checked={isSelected}
                                    disabled={!!quizResult?.passed}
                                    onChange={() => {
                                      const newAnswers = [...quizAnswers];
                                      newAnswers[qi] = oi;
                                      setQuizAnswers(newAnswers);
                                    }}
                                    className="accent-blue-500"
                                  />
                                  <span className="text-xs">{opt}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {quizResult && !quizResult.passed && (
                      <div className="p-3 bg-red-950/10 border border-red-900/30 rounded-md text-xs text-red-400 font-semibold">
                        Not passed — {quizResult.score}/{quizResult.total} correct. Review the material and try again.
                      </div>
                    )}

                    {!quizResult?.passed && (
                      <button
                        onClick={handleSubmitQuiz}
                        className="w-full py-2.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition flex items-center justify-center gap-2"
                      >
                        <GraduationCap className="w-4 h-4" />
                        Submit Quiz
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={handleMarkComplete}
                    className="w-full py-2.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Mark Lesson as Complete
                  </button>
                )}
              </div>

              {/* Previous and Next buttons bar */}
              <div className="flex justify-between items-center pt-6 border-t border-zinc-900">
                {prevLesson ? (
                  <button
                    onClick={() => fetchLessonDetail(activeCourse.course.id, prevLesson.id)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-[#27272a] hover:bg-zinc-900 rounded-lg text-xs font-bold text-zinc-300 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev: {prevLesson.title}
                  </button>
                ) : (
                  <div />
                )}
                {nextLesson ? (
                  <button
                    onClick={() => fetchLessonDetail(activeCourse.course.id, nextLesson.id)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition"
                  >
                    Next: {nextLesson.title}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Course Catalog List */
        <div className="space-y-6">
          {/* Header */}
          <div className="border-b border-[#27272a] pb-5">
            <h1 className="text-xl font-bold tracking-tight">LMS Academy</h1>
            <p className="text-xs text-zinc-400">
              Complete your assigned courses to unlock tools and gain full access.
            </p>
          </div>

          {enrollmentsLoading ? (
            <div className="text-zinc-500 py-10 text-center text-xs animate-pulse">Loading assigned courses...</div>
          ) : enrollments.length === 0 ? (
            <div className="border border-[#27272a] rounded-md p-10 text-center space-y-2">
              <GraduationCap className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-xs text-zinc-500">No courses assigned yet.</p>
              <p className="text-[10px] text-zinc-600">Your team lead will assign training courses based on your role.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {enrollments.map((enrollment: any) => {
                const progress = enrollment.totalLessons > 0
                  ? Math.round((enrollment.completedLessons / enrollment.totalLessons) * 100)
                  : 0;
                const isComplete = enrollment.status === "completed";

                return (
                  <div
                    key={enrollment.id}
                    className={`border rounded-xl p-5 space-y-4 transition hover:border-zinc-700 ${
                      isComplete
                        ? "border-emerald-900/40 bg-emerald-950/5"
                        : "border-[#27272a] bg-[#09090b]"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex justify-between items-start">
                        <h3 className="text-sm font-semibold text-zinc-100">{enrollment.course.title}</h3>
                        {isComplete && <Award className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                      </div>
                      {enrollment.course.description && (
                        <p className="text-[10px] text-zinc-400 line-clamp-2">{enrollment.course.description}</p>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-zinc-500 font-bold uppercase tracking-wider font-mono">Progress</span>
                        <span className="text-zinc-400 font-bold">{enrollment.completedLessons}/{enrollment.totalLessons} lessons</span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isComplete ? "bg-emerald-500" : "bg-[#2563eb]"
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Lesson List */}
                    <div className="space-y-1.5">
                      {enrollment.course.lessons?.map((lesson: any, lIdx: number) => {
                        const isFinished = enrollment.completedLessonIds?.includes(lesson.id);
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => {
                              setActiveCourse(enrollment);
                              fetchLessonDetail(enrollment.course.id, lesson.id);
                            }}
                            className="w-full flex items-center gap-2.5 p-2 bg-zinc-950 border border-zinc-900 rounded-lg text-left hover:border-zinc-700 hover:bg-zinc-900/40 transition group"
                          >
                            <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[9px] font-bold text-zinc-400 flex-shrink-0">
                              {lIdx + 1}
                            </div>
                            <span className="text-[11px] text-zinc-300 group-hover:text-white transition flex-1 truncate">
                              {lesson.title}
                            </span>
                            {isFinished ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                            ) : (
                              <Play className="w-3 h-3 text-zinc-600 group-hover:text-blue-400 transition flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Status */}
                    <div className="pt-2 border-t border-zinc-900 flex justify-between items-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase ${
                          isComplete
                            ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                            : enrollment.status === "in_progress"
                            ? "bg-blue-950/20 text-blue-400 border-blue-900/50"
                            : "bg-zinc-900/20 text-zinc-400 border-zinc-800"
                        }`}
                      >
                        {enrollment.status.replace("_", " ")}
                      </span>
                      {enrollment.course.unlocksToolKey && (
                        <span className="text-[9px] text-zinc-500 flex items-center gap-0.5">
                          <Unlock className="w-2.5 h-2.5" />
                          Unlocks: {enrollment.course.unlocksToolKey}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
