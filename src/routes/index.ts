import { Router } from 'express';

import Paths from '@src/common/Paths';
import UserRoutes from './UserRoutes';
import GoogleDriveRoutes from './GoogleDriveRoutes';
import GSMRoutes from './GSMRoutes';

/******************************************************************************
                                Variables
******************************************************************************/

const apiRouter = Router();

// ** Add UserRouter ** //

// Init router
const userRouter = Router();

// Get all users
userRouter.get(Paths.Users.Get, UserRoutes.getAll);
userRouter.post(Paths.Users.Add, UserRoutes.add);
userRouter.put(Paths.Users.Update, UserRoutes.update);
userRouter.delete(Paths.Users.Delete, UserRoutes.delete);

// Add UserRouter
apiRouter.use(Paths.Users.Base, userRouter);

// ** Add GoogleDriveRouter ** //
apiRouter.use(Paths.GoogleDrive.Base, GoogleDriveRoutes);

// ** Add GSMRouter ** //
apiRouter.use(Paths.GSM.Base, GSMRoutes);

/******************************************************************************
                                Export default
******************************************************************************/

export default apiRouter;