"use client";
import React, { useState, useEffect, useCallback } from "react";
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
  order: number;
  title: string;
  youtubeUrl: string;
  sopMarkdown: string;
  quizQuestions: QuizQuestion[];
  _count?: { progress: number };
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
  totalLessons?: number;
}

interface Course {
  id: string;
  title: string;
  description: string | null;
  assignedRoles: string[];
  unlocksToolKey: string | null;
  status: string;
  _count?: { lessons: number; enrollments: number };
  lessons?: Lesson[];
  enrollments?: Enrollment[];
}

// ─── Props ─────────────────────────────────────────────

interface LmsClientProps {
  currentUser: UserProfile;
  isAdmin: boolean;
  roles: RoleOption[];
  toolKeys: string[];
}

// ─── Component ─────────────────────────────────────────

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
  const [showAddQuiz, setShowAddQuiz] = useState<string | null>(null); // lessonId
  const [adminTab, setAdminTab] = useState<"courses" | "dashboard">("courses");

  // Course form
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDesc, setCourseDesc] = useState("");
  const [courseRoles, setCourseRoles] = useState<string[]>([]);
  const [courseUnlock, setCourseUnlock] = useState("");

  // Lesson form
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonYoutube, setLessonYoutube] = useState("");
  const [lessonSop, setLessonSop] = useState("");

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
  const [activeLesson, setActiveLesson] = useState<any | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<any | null>(null);

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
      if (res.ok) setSelectedCourse(data);
      else toast.error(data.error || "Failed to load course");
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
    try {
      const res = await fetch(`/api/lms/courses/${courseId}/lessons/${lessonId}`);
      const data = await res.json();
      if (res.ok) {
        setActiveLesson(data);
        if (data.quizQuestions?.length > 0) {
          setQuizAnswers(new Array(data.quizQuestions.length).fill(-1));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLessonLoading(false);
    }
  };

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

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse || !lessonTitle || !lessonYoutube) return;

    try {
      const res = await fetch(`/api/lms/courses/${selectedCourse.id}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: lessonTitle,
          youtubeUrl: lessonYoutube,
          sopMarkdown: lessonSop,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Lesson added!");
      setShowCreateLesson(false);
      setLessonTitle("");
      setLessonYoutube("");
      setLessonSop("");
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

  // ── YouTube embed helper ──
  const getYoutubeEmbedUrl = (url: string): string => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
        return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
      }
      if (u.hostname.includes("youtu.be")) {
        return `https://www.youtube.com/embed${u.pathname}`;
      }
      if (u.pathname.includes("/embed/")) return url;
    } catch {}
    return url;
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
            <h1 className="text-xl font-bold tracking-tight">LMS Academy</h1>
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
                <div className="text-zinc-500 py-10 text-center text-xs">Loading courses...</div>
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
                  className="text-xs text-zinc-400 hover:text-white"
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
                  Delete
                </button>
              </div>
            </div>

            {selectedCourse.description && (
              <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
                {selectedCourse.description}
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Lessons Column */}
              <div className="lg:col-span-2 space-y-4">
                <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
                  <div className="flex justify-between items-center pb-3 border-b border-[#27272a] mb-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                      <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                      Lessons ({selectedCourse.lessons?.length || 0})
                    </h3>
                    <button
                      onClick={() => setShowCreateLesson(true)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md text-[10px] font-bold hover:bg-zinc-700 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Lesson
                    </button>
                  </div>

                  {(!selectedCourse.lessons || selectedCourse.lessons.length === 0) ? (
                    <div className="text-zinc-600 text-xs italic text-center py-8">
                      No lessons yet. Add your first lesson above.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedCourse.lessons.map((lesson, idx) => (
                        <div
                          key={lesson.id}
                          className="border border-[#27272a] bg-[#121214] rounded-md p-4 space-y-3 group hover:border-[#3f3f46] transition"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex items-start gap-3">
                              <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-400 flex-shrink-0 mt-0.5">
                                {idx + 1}
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-zinc-100">{lesson.title}</h4>
                                <p className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate max-w-xs">
                                  {lesson.youtubeUrl}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteLesson(lesson.id)}
                              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* SOP Preview */}
                          {lesson.sopMarkdown && (
                            <div className="text-[10px] text-zinc-500 bg-[#09090b] border border-zinc-800/50 rounded-md p-2 line-clamp-2">
                              {lesson.sopMarkdown.substring(0, 120)}...
                            </div>
                          )}

                          {/* Quiz Questions */}
                          <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
                            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                              {lesson.quizQuestions.length} quiz question(s) • {lesson._count?.progress || 0} completion(s)
                            </span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setShowAddQuiz(lesson.id)}
                                className="px-2 py-0.5 text-[9px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 rounded hover:bg-zinc-700 transition"
                              >
                                + Quiz
                              </button>
                            </div>
                          </div>

                          {/* Show quiz questions */}
                          {lesson.quizQuestions.length > 0 && (
                            <div className="space-y-2 pl-9">
                              {lesson.quizQuestions.map((q, qi) => (
                                <div key={q.id} className="text-[10px] bg-[#09090b] border border-zinc-800/50 rounded-md p-2 space-y-1 group/q">
                                  <div className="flex justify-between items-start">
                                    <span className="font-semibold text-zinc-300">Q{qi + 1}: {q.prompt}</span>
                                    <button
                                      onClick={() => handleDeleteQuiz(lesson.id, q.id)}
                                      className="opacity-0 group-hover/q:opacity-100 text-zinc-500 hover:text-red-400 transition"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {q.options.map((opt, oi) => (
                                      <span
                                        key={oi}
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                          oi === q.correctIndex
                                            ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/40"
                                            : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                        }`}
                                      >
                                        {opt} {oi === q.correctIndex && "✓"}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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

        {/* ── Create Lesson Modal ── */}
        {showCreateLesson && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <form
              onSubmit={handleCreateLesson}
              className="w-full max-w-lg border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">Add Lesson</h3>
                <button type="button" onClick={() => setShowCreateLesson(false)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-4 h-4" />
                </button>
              </div>

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
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">YouTube Video URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://youtube.com/watch?v=..."
                  value={lessonYoutube}
                  onChange={(e) => setLessonYoutube(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">SOP (Markdown)</label>
                <textarea
                  placeholder="# Standard Operating Procedure&#10;&#10;Write your markdown SOP here..."
                  value={lessonSop}
                  onChange={(e) => setLessonSop(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-40 resize-y font-mono"
                />
              </div>

              <div className="flex gap-3 justify-end pt-3">
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
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
      {/* Header */}
      <div className="border-b border-[#27272a] pb-5">
        <h1 className="text-xl font-bold tracking-tight">My Training</h1>
        <p className="text-xs text-zinc-400">
          Complete your assigned courses to unlock tools and gain full access.
        </p>
      </div>

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
              }}
              className="text-xs text-zinc-400 hover:text-white"
            >
              &larr; Back to Courses
            </button>
            <div className="h-4 w-px bg-zinc-700" />
            <span className="text-xs text-zinc-500">{activeCourse.course.title}</span>
            <ChevronRight className="w-3 h-3 text-zinc-600" />
            <span className="text-xs text-zinc-200 font-semibold">{activeLesson.title}</span>
          </div>

          {/* Video Player */}
          <div className="border border-[#27272a] rounded-lg overflow-hidden bg-black">
            <div className="aspect-video">
              <iframe
                src={getYoutubeEmbedUrl(activeLesson.youtubeUrl)}
                title={activeLesson.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          </div>

          {/* SOP Markdown */}
          {activeLesson.sopMarkdown && (
            <div className="border border-[#27272a] rounded-md bg-[#121214] p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-3 mb-4">
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                Standard Operating Procedure
              </h3>
              <div className="prose prose-invert prose-xs max-w-none text-zinc-300 text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-zinc-100 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:text-zinc-200 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-zinc-300 [&_code]:bg-zinc-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-[#09090b] [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:rounded-md [&_ul]:text-zinc-400 [&_ol]:text-zinc-400 [&_li]:text-zinc-400 [&_a]:text-blue-400 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-500 [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-700 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-zinc-400 [&_th]:text-[10px] [&_th]:uppercase [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-1.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {activeLesson.sopMarkdown}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Quiz or Mark Complete */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-6 space-y-4">
            {activeLesson.userProgress ? (
              <div className="flex items-center gap-3 p-4 bg-emerald-950/10 border border-emerald-900/30 rounded-md">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-400">Lesson Completed</p>
                  <p className="text-[10px] text-zinc-400">
                    Completed on {new Date(activeLesson.userProgress.completedAt).toLocaleDateString()}
                    {activeLesson.userProgress.quizScore !== null && ` • Quiz score: ${activeLesson.userProgress.quizScore}`}
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
                              className={`flex items-center gap-2.5 p-2.5 border rounded-md cursor-pointer transition hover:border-zinc-600 ${optClass}`}
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
        </div>
      ) : (
        /* Course List */
        <div className="space-y-6">
          {enrollmentsLoading ? (
            <div className="text-zinc-500 py-10 text-center text-xs">Loading your courses...</div>
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
                    className={`border rounded-md p-5 space-y-4 transition hover:border-zinc-700 ${
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
                        <span className="text-zinc-500 font-bold uppercase tracking-wider">Progress</span>
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
                      {enrollment.course.lessons?.map((lesson: any) => {
                        // We don't have per-lesson completion in this view, show order only
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => {
                              setActiveCourse(enrollment);
                              fetchLessonDetail(enrollment.course.id, lesson.id);
                            }}
                            className="w-full flex items-center gap-2 p-2 bg-[#121214] border border-[#27272a]/30 rounded-md text-left hover:border-zinc-700 transition group"
                          >
                            <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[9px] font-bold text-zinc-400 flex-shrink-0">
                              {lesson.order + 1}
                            </div>
                            <span className="text-[11px] text-zinc-300 group-hover:text-white transition flex-1 truncate">
                              {lesson.title}
                            </span>
                            <Play className="w-3 h-3 text-zinc-500 group-hover:text-blue-400 transition flex-shrink-0" />
                          </button>
                        );
                      })}
                    </div>

                    {/* Status */}
                    <div className="pt-2 border-t border-zinc-800 flex justify-between items-center">
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
