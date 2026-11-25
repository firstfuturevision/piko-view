from django.utils import timezone
from rest_framework import serializers

from .models import Category, Schedule


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'color']

    def validate_name(self, value):
        # 전체 공유이므로 이름 중복은 전체 기준으로 검사한다
        qs = Category.objects.filter(name=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('이미 같은 이름의 카테고리가 있습니다.')
        return value


class ScheduleSerializer(serializers.ModelSerializer):
    owner_username = serializers.ReadOnlyField(source='owner.username')
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), allow_null=True, required=False,
    )
    category_name = serializers.ReadOnlyField(source='category.name')
    category_color = serializers.ReadOnlyField(source='category.color')

    class Meta:
        model = Schedule
        fields = [
            'id', 'title', 'description', 'start_at', 'end_at',
            'is_all_day', 'category', 'category_name', 'category_color',
            'owner_username', 'is_done', 'is_pinned', 'repeat', 'repeat_until',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'category_name', 'category_color', 'owner_username',
            'created_at', 'updated_at',
        ]

    def validate(self, attrs):
        start_at = attrs.get('start_at', getattr(self.instance, 'start_at', None))
        end_at = attrs.get('end_at', getattr(self.instance, 'end_at', None))
        if start_at and end_at and end_at < start_at:
            raise serializers.ValidationError('종료 시각은 시작 시각보다 빠를 수 없습니다.')
        until = attrs.get('repeat_until', getattr(self.instance, 'repeat_until', None))
        if start_at and until and until < timezone.localtime(start_at).date():
            raise serializers.ValidationError('반복이 끝나는 날은 시작 날짜보다 빠를 수 없습니다.')
        return attrs
