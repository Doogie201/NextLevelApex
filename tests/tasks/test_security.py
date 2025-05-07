def test_security_smoke():
    from nextlevelapex.tasks.security import security_task

    res = security_task({"config": {"security": {}}, "dry_run": True, "verbose": False})
    assert res.success
