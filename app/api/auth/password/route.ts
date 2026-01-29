import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { users } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { hashPassword, comparePassword } from "@/lib/utils"
import { z } from "zod"

export const runtime = 'edge';

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(8, "新密码长度必须大于等于8位"),
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "两次输入的密码不一致",
  path: ["confirmPassword"]
})

export async function PUT(req: Request) {
    try {
        const session = await auth()
        if (!session?.user?.id) {
            return new Response("Unauthorized", { status: 401 })
        }

        const body = await req.json()
        const result = updatePasswordSchema.safeParse(body)
        
        if (!result.success) {
            return NextResponse.json({ 
                error: result.error.errors[0].message 
            }, { status: 400 })
        }

        const { currentPassword, newPassword } = result.data
        const db = createDb()
        
        // 1. Get user password hash
        const user = await db.query.users.findFirst({
            where: eq(users.id, session.user.id),
            columns: { password: true }
        })

        if (!user || !user.password) {
            return NextResponse.json({ error: "当前用户未设置密码，无法修改" }, { status: 400 })
        }

        // 2. Verify current password
        const isValid = await comparePassword(currentPassword, user.password)
        if (!isValid) {
            return NextResponse.json({ error: "当前密码错误" }, { status: 400 })
        }

        // 3. Update password
        const hashedPassword = await hashPassword(newPassword)
        await db.update(users)
            .set({ password: hashedPassword })
            .where(eq(users.id, session.user.id))

        return NextResponse.json({ success: true, message: "密码修改成功" })

    } catch (error) {
        console.error("Change password error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
