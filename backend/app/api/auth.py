"""Регистрация и вход. Роль в MVP одна — владелец аккаунта."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.config import settings
from app.deps import SessionDep, UserDep
from app.models import User
from app.schemas import Credentials, TokenOut, UserOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(payload: Credentials, session: SessionDep) -> TokenOut:
    exists = await session.execute(select(User).where(User.email == payload.email))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким адресом уже есть")

    user = User(
        email=str(payload.email),
        hashed_password=hash_password(payload.password),
        monthly_request_limit=settings.monthly_request_limit,
        monthly_budget_kopecks=settings.monthly_budget_kopecks,
    )
    session.add(user)
    await session.commit()
    return TokenOut(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenOut)
async def login(payload: Credentials, session: SessionDep) -> TokenOut:
    result = await session.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный адрес или пароль")
    return TokenOut(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
async def me(user: UserDep) -> User:
    return user
