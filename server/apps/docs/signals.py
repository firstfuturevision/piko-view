from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import CollabState, Comment, Doc


@receiver(post_delete, sender=Doc)
def _doc_deleted(sender, instance, **kwargs):
    CollabState.objects.filter(kind='doc', object_id=instance.pk).delete()
    Comment.objects.filter(target_kind='doc', target_id=instance.pk).delete()
