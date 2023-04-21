import dayjs from 'dayjs';

import { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "./lib/prisma";

export async function appRoutes(app: FastifyInstance) {
	app.post('/habits', async (request, reply) => {
		const createHabitBody = z.object({
			title: z.string(),
			weekDays: z.array(
				z.number().min(0).max(6)
			)
		})

		const { title, weekDays } = createHabitBody.parse(request.body);

		// zerando horas, minutos e segundos
		const today = dayjs().startOf('day').toDate();

		await prisma.habit.create({
			data: {
				title,
				created_at: today,
				weekDays: {
					create: weekDays.map(weekDay => {
						return {
							week_day: weekDay,
						}
					})
				}
			}
		})

		reply.code(201);
	});

	app.get('/day', async (request) => {
		const getDayParams = z.object({
			date: z.coerce.date()
		});

		const { date } = getDayParams.parse(request.query);

		const parsedDate = dayjs(date).startOf('day');
		const weekDay = parsedDate.get('day');

		// retornar todos os hábitos possíveis do dia
		// hábitos que já foram completados

		const possibleHabits = await prisma.habit.findMany({
			where: {
				created_at: {
					lte: date,
				},
				weekDays: {
					some: {
						week_day: weekDay,
					}
				}
			}
		});

		const day = await prisma.day.findUnique({
			where: {
				date: parsedDate.toDate()
			},
			include: {
				dayHabits: true
			}
		});

		const completedHabits = day?.dayHabits.map(dayHabit => {
			return dayHabit.habit_id;
		}) ?? [];

		return {
			possibleHabits,
			completedHabits
		}
	});

	// toggle para completar hábito
	app.patch('/habits/:id/toggle', async (request) => {
		const toggleHabitsParams = z.object({
			id: z.string().uuid(),
		});

		const { id } = toggleHabitsParams.parse(request.params);

		const today = dayjs().startOf('day').toDate();

		let day = await prisma.day.findUnique({
			where: {
				date: today
			}
		});

		if (!day) {
			day = await prisma.day.create({
				data: {
					date: today
				},
			});
		}

		const dayHabit = await prisma.dayHabit.findUnique({
			where: {
				day_id_habit_id: {
					day_id: day.id,
					habit_id: id
				}
			}
		});

		if (dayHabit) {
			// remover a marcação de hábito completo
			await prisma.dayHabit.delete({
				where: {
					id: dayHabit.id
				}
			});
			return {
				message: 'Deletado com sucesso'
			}
		} else {
			// completar o hábito no dia
			await prisma.dayHabit.create({
				data: {
					day_id: day.id,
					habit_id: id
				}
			});
			return {
				message: 'Criado com sucesso'
			}
		}
	});

	// resumo dos dias
	app.get('/summary', async () => {
		// [{ date, amountHabits, completedHabits }, {}, {}]
		const summary = await prisma.$queryRaw`
			SELECT
				D.id, D.date,
				(
					SELECT
						cast(count(*) as float)
					FROM day_habits DH
					WHERE DH.day_id = D.id
				) as completed,
				(
					SELECT
						cast(count(*) as float)
					FROM habit_week_days HWD
					JOIN habits H
						ON H.id = HWD.habit_id
					WHERE
						HWD.week_day = cast(strftime('%w', D.date / 1000.0, 'unixepoch') as int)
						AND H.created_at <= D.date
				) as amount
			FROM days D
		`;

		return summary;
	});

}
