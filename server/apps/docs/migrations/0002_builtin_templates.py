"""기본 템플릿(빈 문서·회의록·기획서·주간 보고·슬라이드 둘)을 넣는다. 내용은 apps/docs/formats.py."""
from django.db import migrations


def seed(apps, schema_editor):
    from apps.docs.formats import BUILTIN_TEMPLATES

    Template = apps.get_model('docs', 'Template')
    for t in BUILTIN_TEMPLATES:
        Template.objects.update_or_create(builtin=True, kind=t['kind'], name=t['name'],
                                          defaults={'description': t['description'], 'content': t['content']})


def unseed(apps, schema_editor):
    apps.get_model('docs', 'Template').objects.filter(builtin=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('docs', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
