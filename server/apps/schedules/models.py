from django.conf import settings
from django.db import models


class Color(models.TextChoices):
    RED = 'red', '빨강'
    ORANGE = 'orange', '주황'
    YELLOW = 'yellow', '노랑'
    GREEN = 'green', '초록'
    BLUE = 'blue', '파랑'
    NAVY = 'navy', '남색'
    PURPLE = 'purple', '보라'
    BLACK = 'black', '검정'


class Category(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='categories',
    )
    name = models.CharField(max_length=50)
    color = models.CharField(
        max_length=10, choices=Color.choices, default=Color.BLUE,
    )

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['owner', 'name'], name='unique_category_per_owner',
            ),
        ]

    def __str__(self):
        return self.name


class Repeat(models.TextChoices):
    NONE = '', '안 함'
    WEEKLY = 'weekly', '매주'
    MONTHLY = 'monthly', '매월'


class Schedule(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='schedules',
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)
    is_all_day = models.BooleanField(default=False)
    # 색상은 카테고리에서 온다. 카테고리 미지정 일정은 프론트에서 회색으로 표시.
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='schedules',
    )
    is_done = models.BooleanField(default=False)
    # 목록 상단 고정 (별표)
    is_pinned = models.BooleanField(default=False)
    # 반복: start_at 의 요일(매주)·날짜(매월)로 되풀이한다. 발생분 계산은 repeat.py
    repeat = models.CharField(max_length=10, choices=Repeat.choices, default=Repeat.NONE, blank=True)
    # 이 날짜까지 시작하는 발생분만 (비우면 계속)
    repeat_until = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_at']

    def __str__(self):
        return self.title
