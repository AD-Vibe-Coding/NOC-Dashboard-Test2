import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";
import { defaultRoleFor, lookupByEmail } from "./_lib/roles.js";

function send(res: VercelResponse, code: number, body: unknown) {
  return res.status(code).json(body);
}

function isMissingColumnError(error: { message?: string | null } | null | undefined, column: string) {
  return String(error?.message ?? "").includes(column);
}

function withManagerFeedbackFallback<T extends Record<string, any>>(rows: T[] | null | undefined) {
  return (rows ?? []).map((row) => ({
    recipient_read_at: null,
    recipient_comment: null,
    recipient_comment_by: null,
    recipient_comment_at: null,
    recipient_acknowledged_at: null,
    recipient_acknowledged_by: null,
    ...row,
  }));
}

function anonymizeRecipientRows<T extends Record<string, any>>(rows: T[] | null | undefined, sessionName: string) {
  return (rows ?? []).map((row) => ({
    ...row,
    feedback_from: "Anonymous",
    submitted_by: null,
    approved_by: null,
    feedback_for: sessionName,
    recipient_comment_by: row.recipient_comment_by ? sessionName : null,
    recipient_acknowledged_by: row.recipient_acknowledged_by ? sessionName : null,
  }));
}

function getEffectiveRole(session: { role?: string | null; email?: string | null; name?: string | null } | null) {
  if (!session) return "anonymous";
  return (
    session.role
    ?? lookupByEmail(String(session.email ?? "").toLowerCase())?.role
    ?? defaultRoleFor(String(session.name ?? ""))
    ?? "anonymous"
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = getSession(req);
  const role = getEffectiveRole(session);
  const sessionName = String(session?.name ?? "").trim();

  if (!sessionName) {
    return send(res, 403, { error: "Sign in required." });
  }

  try {
    if (req.method === "GET") {
      const applyScope = (query: ReturnType<typeof supabaseAdmin.from>) => {
        if (role === "manager") {
          return query.order("created_at", { ascending: false });
        }
        return query
          .eq("feedback_for", sessionName)
          .eq("approval_status", "approved")
          .order("approved_at", { ascending: false });
      };

      let { data, error } = await applyScope(supabaseAdmin.from("manager_feedback").select("*"));

      if (
        isMissingColumnError(error, "recipient_comment")
        || isMissingColumnError(error, "recipient_read_at")
        || isMissingColumnError(error, "recipient_acknowledged_at")
      ) {
        const fallback = await applyScope(
          supabaseAdmin
            .from("manager_feedback")
            .select("id, feedback_from, feedback_for, ticket_number, comment, submitted_by, approval_status, approved_by, approved_at, created_at")
        );
        data = withManagerFeedbackFallback(fallback.data);
        error = fallback.error;
      }

      if (error) {
        return send(res, 500, { error: error.message });
      }

      const rows = withManagerFeedbackFallback(data);

      if (role !== "manager" && req.query.markRead === "true" && rows.length > 0) {
        const unreadIds = rows
          .filter((row) => !row.recipient_read_at)
          .map((row) => Number(row.id))
          .filter((value) => Number.isFinite(value));

        if (unreadIds.length > 0) {
          const markReadAt = new Date().toISOString();
          const updateResult = await supabaseAdmin
            .from("manager_feedback")
            .update({ recipient_read_at: markReadAt })
            .in("id", unreadIds)
            .eq("feedback_for", sessionName)
            .eq("approval_status", "approved");

          if (!isMissingColumnError(updateResult.error, "recipient_read_at")) {
            rows.forEach((row) => {
              if (unreadIds.includes(Number(row.id))) {
                row.recipient_read_at = markReadAt;
              }
            });
          }
        }
      }

      return send(res, 200, role === "manager" ? rows : anonymizeRecipientRows(rows, sessionName));
    }

    if (req.method === "PATCH") {
      const body = req.body ?? {};
      const raw = body.values !== undefined ? body.values : body;
      const row = Array.isArray(raw) ? raw[0] : raw;

      const id = Number(row?.id);
      const feedbackFrom = row?.feedback_from !== undefined ? String(row.feedback_from ?? "").trim() : undefined;
      const feedbackFor = row?.feedback_for !== undefined ? String(row.feedback_for ?? "").trim() : undefined;
      const comment = row?.comment !== undefined ? String(row.comment ?? "").trim() : undefined;
      const ticketNumber = row?.ticket_number !== undefined ? (String(row.ticket_number ?? "").trim() || null) : undefined;
      const approvalStatus = row?.approval_status !== undefined ? String(row.approval_status ?? "").trim() : undefined;
      const recipientComment = row?.recipient_comment !== undefined ? String(row.recipient_comment ?? "").trim() : undefined;
      const recipientAcknowledge = row?.recipient_acknowledge === true;

      if (!Number.isFinite(id) || id <= 0) {
        return send(res, 400, { error: "A valid feedback id is required." });
      }

      const managerChangeRequested = [feedbackFrom, feedbackFor, comment, ticketNumber, approvalStatus].some((value) => value !== undefined);
      const recipientCommentRequested = recipientComment !== undefined;
      const recipientAcknowledgeRequested = recipientAcknowledge;

      if (managerChangeRequested && role !== "manager") {
        return send(res, 403, { error: "Only managers can edit feedback details." });
      }

      if (!managerChangeRequested && !recipientCommentRequested && !recipientAcknowledgeRequested) {
        return send(res, 400, { error: "No valid fields were provided to update." });
      }

      if (
        Number(recipientCommentRequested) + Number(recipientAcknowledgeRequested) + Number(managerChangeRequested) > 1
      ) {
        return send(res, 400, { error: "Update feedback details, recipient comment, and acknowledgement separately." });
      }

      const changes: Record<string, unknown> = {};
      let updateQuery = supabaseAdmin.from("manager_feedback").update(changes).eq("id", id);

      if (recipientCommentRequested) {
        if (!recipientComment) {
          return send(res, 400, { error: "Recipient comment cannot be empty." });
        }

        changes.recipient_comment = recipientComment;
        changes.recipient_comment_by = sessionName;
        changes.recipient_comment_at = new Date().toISOString();
        updateQuery = supabaseAdmin
          .from("manager_feedback")
          .update(changes)
          .eq("id", id)
          .eq("feedback_for", sessionName)
          .eq("approval_status", "approved");
      } else if (recipientAcknowledgeRequested) {
        changes.recipient_acknowledged_by = sessionName;
        changes.recipient_acknowledged_at = new Date().toISOString();
        updateQuery = supabaseAdmin
          .from("manager_feedback")
          .update(changes)
          .eq("id", id)
          .eq("feedback_for", sessionName)
          .eq("approval_status", "approved");
      } else {
        if (feedbackFrom !== undefined) {
          if (!feedbackFrom) return send(res, 400, { error: "feedback_from cannot be empty." });
          changes.feedback_from = feedbackFrom;
        }
        if (feedbackFor !== undefined) {
          if (!feedbackFor) return send(res, 400, { error: "feedback_for cannot be empty." });
          changes.feedback_for = feedbackFor;
        }
        if (comment !== undefined) {
          if (!comment) return send(res, 400, { error: "comment cannot be empty." });
          changes.comment = comment;
        }
        if (ticketNumber !== undefined) {
          changes.ticket_number = ticketNumber;
        }
        if (approvalStatus !== undefined) {
          changes.approval_status = approvalStatus;
          if (approvalStatus === "approved") {
            changes.approved_by = sessionName;
            changes.approved_at = new Date().toISOString();
          }
        }

        updateQuery = supabaseAdmin.from("manager_feedback").update(changes).eq("id", id);
      }

      let { data, error } = await updateQuery.select();

      if (
        isMissingColumnError(error, "recipient_comment")
        || isMissingColumnError(error, "recipient_read_at")
        || isMissingColumnError(error, "recipient_acknowledged_at")
      ) {
        const fallback = await updateQuery.select("id, feedback_from, feedback_for, ticket_number, comment, submitted_by, approval_status, approved_by, approved_at, created_at");
        data = withManagerFeedbackFallback(fallback.data);
        error = fallback.error;
      }

      if (error) {
        return send(res, 500, { error: error.message });
      }

      if (!data || data.length === 0) {
        return send(res, 404, {
          error: recipientCommentRequested
            ? "Only the feedback recipient can comment on approved feedback."
            : recipientAcknowledgeRequested
              ? "Only the feedback recipient can acknowledge approved feedback."
              : "Feedback record not found.",
        });
      }

      return send(res, 200, withManagerFeedbackFallback(data));
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const raw = body.values !== undefined ? body.values : body;
      const row = Array.isArray(raw) ? raw[0] : raw;

      const feedbackFor = String(row?.feedback_for ?? "").trim();
      const comment = String(row?.comment ?? "").trim();
      const ticketNumber = String(row?.ticket_number ?? "").trim() || null;
      const requestedFrom = String(row?.feedback_from ?? "").trim();
      const submittedBy = sessionName;
      const isManager = role === "manager";
      const feedbackFrom = isManager ? requestedFrom || submittedBy : submittedBy;
      const approvalStatus = isManager ? "approved" : "pending";
      const approvedBy = isManager ? submittedBy : null;
      const approvedAt = isManager ? new Date().toISOString() : null;
      const recipientReadAt = null;
      const recipientAcknowledgedAt = null;
      const recipientAcknowledgedBy = null;

      if (!feedbackFor || !comment || !feedbackFrom) {
        return send(res, 400, { error: "feedback_for, comment, and feedback_from are required." });
      }

      let { data, error } = await supabaseAdmin
        .from("manager_feedback")
        .insert({
          feedback_from: feedbackFrom,
          feedback_for: feedbackFor,
          ticket_number: ticketNumber,
          comment,
          submitted_by: submittedBy,
          approval_status: approvalStatus,
          approved_by: approvedBy,
          approved_at: approvedAt,
          recipient_read_at: recipientReadAt,
          recipient_acknowledged_at: recipientAcknowledgedAt,
          recipient_acknowledged_by: recipientAcknowledgedBy,
        })
        .select();

      if (
        isMissingColumnError(error, "recipient_comment")
        || isMissingColumnError(error, "recipient_read_at")
        || isMissingColumnError(error, "recipient_acknowledged_at")
      ) {
        const fallback = await supabaseAdmin
          .from("manager_feedback")
          .insert({
            feedback_from: feedbackFrom,
            feedback_for: feedbackFor,
            ticket_number: ticketNumber,
            comment,
            submitted_by: submittedBy,
            approval_status: approvalStatus,
            approved_by: approvedBy,
            approved_at: approvedAt,
          })
          .select();
        data = withManagerFeedbackFallback(fallback.data);
        error = fallback.error;
      }

      if (error) {
        return send(res, 500, { error: error.message });
      }

      return send(res, 201, withManagerFeedbackFallback(data));
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return send(res, 500, {
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
